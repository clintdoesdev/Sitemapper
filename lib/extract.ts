import { blockedHostReason, Budget, decodeEntities, fetchText, parseRobots, toHttpUrl, type Robots } from "./crawl";

export const MAX_EXTRACT_URLS = 10;
const EXTRACT_CONCURRENCY = 4;
const EXTRACT_BUDGET_MS = 45_000;
const MAX_TEXT_CHARS = 20_000;
const MAX_HEADINGS = 60;

export type Heading = { level: number; text: string };

export type PageContents = {
  url: string;
  ok: true;
  status: number;
  finalUrl: string;
  lang: string;
  title: string;
  description: string;
  canonical: string;
  robots: string;
  h1: string;
  headings: Heading[];
  schemaTypes: string[];
  wordCount: number;
  internalLinks: number;
  externalLinks: number;
  text: string;
  textTruncated: boolean;
};

export type PageFailure = { url: string; ok: false; error: string };

export type ExtractResult = PageContents | PageFailure;

// ---------------------------------------------------------------------------
// HTML helpers (regex based, tolerant of messy markup)
// ---------------------------------------------------------------------------

function attributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  for (const match of tag.matchAll(pattern)) {
    attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

function tags(html: string, name: string): Record<string, string>[] {
  const pattern = new RegExp(`<${name}\\b[^>]*>`, "gi");
  return [...html.matchAll(pattern)].map((match) => attributes(match[0]));
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Strips tags from an HTML fragment and returns its visible text on one line. */
function inlineText(fragment: string): string {
  return collapse(decodeEntities(fragment.replace(/<[^>]+>/g, " ")));
}

function removeElements(html: string, names: string[]): string {
  let result = html;
  for (const name of names) {
    result = result.replace(new RegExp(`<${name}\\b[\\s\\S]*?<\\/${name}\\s*>`, "gi"), " ");
  }
  return result;
}

/** The page's main content: <main>, else <article>, else <body> without site chrome. */
function mainContent(html: string): string {
  const main = /<main\b[^>]*>([\s\S]*?)<\/main\s*>/i.exec(html);
  if (main && inlineText(main[1]).length > 200) return main[1];
  const articles = [...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article\s*>/gi)].map((m) => m[1]);
  if (articles.length > 0 && inlineText(articles.join(" ")).length > 200) return articles.join("\n");
  const body = /<body\b[^>]*>([\s\S]*)<\/body\s*>/i.exec(html);
  return removeElements(body ? body[1] : html, ["header", "nav", "footer", "aside"]);
}

/** Converts an HTML fragment to readable plain text, keeping paragraph breaks. */
function readableText(fragment: string): string {
  const text = fragment
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(?:p|div|section|article|li|ul|ol|tr|table|h[1-6]|blockquote|pre|dd|dt|figure|figcaption)\b[^>]*>/gi, "\n")
    .replace(/<\/t[dh]\s*>/gi, "\t")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(text)
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function schemaTypes(html: string): string[] {
  const types = new Set<string>();
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    const type = record["@type"];
    if (typeof type === "string") types.add(type);
    else if (Array.isArray(type)) type.forEach((t) => typeof t === "string" && types.add(t));
    if (record["@graph"]) visit(record["@graph"]);
    if (record.mainEntity) visit(record.mainEntity);
  };
  const pattern = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;
  for (const match of html.matchAll(pattern)) {
    try {
      visit(JSON.parse(match[1].replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, "")));
    } catch {
      // Ignore invalid JSON-LD blocks.
    }
  }
  return [...types];
}

/** Pulls the parts of a page that show how it was built. */
export function extractContents(html: string, pageUrl: string): Omit<PageContents, "url" | "ok" | "status" | "finalUrl"> {
  const metas = tags(html, "meta");
  const meta = (key: string) =>
    collapse(
      metas.find((attrs) => (attrs.name ?? attrs.property ?? "").toLowerCase() === key)?.content ?? "",
    );
  const canonicalTag = tags(html, "link").find((attrs) =>
    (attrs.rel ?? "").toLowerCase().split(/\s+/).includes("canonical"),
  );
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);

  const cleaned = removeElements(html.replace(/<!--[\s\S]*?-->/g, " "), [
    "script",
    "style",
    "noscript",
    "template",
    "svg",
    "iframe",
  ]);

  const headings: Heading[] = [];
  for (const match of cleaned.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)) {
    const text = inlineText(match[2]);
    if (text) headings.push({ level: Number(match[1]), text });
  }

  const pageHost = new URL(pageUrl).hostname.replace(/^www\./, "");
  let internalLinks = 0;
  let externalLinks = 0;
  for (const attrs of tags(cleaned, "a")) {
    if (!attrs.href || /^(?:mailto|tel|javascript|#)/i.test(attrs.href)) continue;
    const href = toHttpUrl(attrs.href, pageUrl);
    if (!href) continue;
    if (new URL(href).hostname.replace(/^www\./, "") === pageHost) internalLinks++;
    else externalLinks++;
  }

  const text = readableText(mainContent(cleaned));
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];
  const htmlTag = /<html\b[^>]*>/i.exec(html);

  return {
    lang: htmlTag ? (attributes(htmlTag[0]).lang ?? "") : "",
    title: titleMatch ? inlineText(titleMatch[1]) : meta("og:title"),
    description: meta("description") || meta("og:description"),
    canonical: canonicalTag?.href ? (toHttpUrl(canonicalTag.href, pageUrl) ?? canonicalTag.href) : "",
    robots: meta("robots"),
    h1: headings.find((heading) => heading.level === 1)?.text ?? "",
    headings: headings.slice(0, MAX_HEADINGS),
    schemaTypes: schemaTypes(html),
    wordCount: words.length,
    internalLinks,
    externalLinks,
    text: text.slice(0, MAX_TEXT_CHARS),
    textTruncated: text.length > MAX_TEXT_CHARS,
  };
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

async function robotsFor(origin: string, budget: Budget): Promise<Robots> {
  const response = await fetchText(`${origin}/robots.txt`, budget);
  const text =
    response.ok && response.status < 400 && !/text\/html/i.test(response.contentType) ? response.text : "";
  return parseRobots(text, origin);
}

async function extractOne(url: string, robots: Robots, budget: Budget): Promise<ExtractResult> {
  if (!robots.isAllowed(url)) return { url, ok: false, error: "Blocked by the site's robots.txt." };
  const response = await fetchText(url, budget);
  if (!response.ok) {
    const error =
      response.reason === "timeout"
        ? "Took longer than 10 seconds to respond."
        : response.reason === "blocked"
          ? "Redirected to a private address."
          : "The request failed.";
    return { url, ok: false, error };
  }
  if (response.status >= 400) return { url, ok: false, error: `Returned status ${response.status}.` };
  if (!/text\/html|application\/xhtml\+xml/i.test(response.contentType)) {
    return { url, ok: false, error: "Not an HTML page." };
  }
  return {
    url,
    ok: true,
    status: response.status,
    finalUrl: response.url,
    ...extractContents(response.text, response.url),
  };
}

/** Fetches up to MAX_EXTRACT_URLS pages and extracts their contents, in input order. */
export async function extractPages(urls: string[]): Promise<ExtractResult[]> {
  const budget = new Budget(EXTRACT_BUDGET_MS);
  const results: ExtractResult[] = new Array(urls.length);
  const robotsByOrigin = new Map<string, Promise<Robots>>();

  const valid: { index: number; url: string; origin: string }[] = [];
  urls.forEach((raw, index) => {
    const url = toHttpUrl(raw);
    if (!url) {
      results[index] = { url: raw, ok: false, error: "Not a valid URL." };
      return;
    }
    const parsed = new URL(url);
    if (blockedHostReason(parsed.hostname)) {
      results[index] = { url: raw, ok: false, error: "Private and local addresses can't be read." };
      return;
    }
    valid.push({ index, url, origin: parsed.origin });
  });

  for (let start = 0; start < valid.length; start += EXTRACT_CONCURRENCY) {
    const batch = valid.slice(start, start + EXTRACT_CONCURRENCY);
    await Promise.all(
      batch.map(async ({ index, url, origin }) => {
        if (budget.expired()) {
          results[index] = { url: urls[index], ok: false, error: "Ran out of time. Try again." };
          return;
        }
        let robots = robotsByOrigin.get(origin);
        if (!robots) {
          robots = robotsFor(origin, budget);
          robotsByOrigin.set(origin, robots);
        }
        const result = await extractOne(url, await robots, budget);
        results[index] = { ...result, url: urls[index] };
      }),
    );
  }
  return results;
}
