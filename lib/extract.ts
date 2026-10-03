import {
  blockedHostReason,
  Budget,
  decodeEntities,
  type Identity,
  fetchText,
  looksJavaScriptBuilt,
  parseRobots,
  toHttpUrl,
  type Robots,
} from "./crawl";
import { renderPage, withBrowser } from "./render";

export const MAX_EXTRACT_URLS = 10;
export const MAX_RENDER_URLS = 4;
const EXTRACT_CONCURRENCY = 4;
const RENDER_CONCURRENCY = 2;
const GENTLE_PAUSE_MS = 700;
const EXTRACT_BUDGET_MS = 45_000;
// Spreadsheet cells hold at most 32,767 characters.
export const MAX_TEXT_CHARS = 32_000;
const MAX_HEADINGS = 200;

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
  /** True when the contents were read after running the page's JavaScript. */
  rendered: boolean;
  /** True when the raw HTML looks like a JavaScript shell worth rendering. */
  needsRender: boolean;
  /** Why rendering failed, when the HTML reading was kept instead. */
  renderError?: string;
};

export type PageFailure = {
  url: string;
  ok: false;
  error: string;
  /** True for temporary failures (rate limits, server errors, timeouts) worth retrying later. */
  retryable?: boolean;
  /** Seconds the site asked us to wait before trying again. */
  retryAfter?: number;
  /** True when the site answered 429 Too Many Requests. */
  rateLimited?: boolean;
  /** True when the site refused the request (401/403), so a real browser may get further. */
  blocked?: boolean;
};

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
export function extractContents(
  html: string,
  pageUrl: string,
): Omit<PageContents, "url" | "ok" | "status" | "finalUrl" | "rendered" | "needsRender"> {
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

async function loadRobots(origin: string, budget: Budget): Promise<Robots> {
  const response = await fetchText(`${origin}/robots.txt`, budget);
  const text =
    response.ok && response.status < 400 && !/text\/html/i.test(response.contentType) ? response.text : "";
  return parseRobots(text, origin);
}

async function extractOne(url: string, budget: Budget): Promise<ExtractResult> {
  const response = await fetchText(url, budget, { html: true });
  if (!response.ok) {
    if (response.reason === "blocked") return { url, ok: false, error: "Redirected to a private address." };
    return {
      url,
      ok: false,
      retryable: true,
      error:
        response.reason === "timeout"
          ? "Took longer than 10 seconds to respond."
          : "The connection failed.",
    };
  }
  const { status } = response;
  if (status === 429) {
    return {
      url,
      ok: false,
      retryable: true,
      rateLimited: true,
      retryAfter: response.retryAfter ?? undefined,
      error: "The site asked for fewer requests (status 429).",
    };
  }
  if (status === 401 || status === 403) {
    return { url, ok: false, blocked: true, error: `The site blocked automated requests (status ${status}).` };
  }
  if (status >= 500) {
    return {
      url,
      ok: false,
      retryable: true,
      retryAfter: response.retryAfter ?? undefined,
      error: `The site returned a server error (status ${status}).`,
    };
  }
  if (status >= 400) return { url, ok: false, error: `The page returned status ${status}.` };
  if (!/text\/html|application\/xhtml\+xml/i.test(response.contentType)) {
    const type = response.contentType.split(";")[0].trim();
    return { url, ok: false, error: `Not an HTML page${type ? ` (${type})` : ""}.` };
  }
  const contents = extractContents(response.text, response.url);
  return {
    url,
    ok: true,
    status: response.status,
    finalUrl: response.url,
    ...contents,
    rendered: false,
    needsRender: looksJavaScriptBuilt(response.text, contents.wordCount),
  };
}

type Target = { index: number; url: string; origin: string };

function validate(urls: string[], results: ExtractResult[]): Target[] {
  const valid: Target[] = [];
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
  return valid;
}

/**
 * Reads pages and extracts their contents, in input order. With `render`,
 * each page is loaded in a headless browser so its JavaScript runs first.
 */
export async function extractPages(
  urls: string[],
  options: { render?: boolean; gentle?: boolean; identity?: Identity } = {},
): Promise<ExtractResult[]> {
  const budget = new Budget(EXTRACT_BUDGET_MS, options.identity);
  const results: ExtractResult[] = new Array(urls.length);
  const robotsByOrigin = new Map<string, Promise<Robots>>();
  const robotsFor = (origin: string) => {
    let robots = robotsByOrigin.get(origin);
    if (!robots) {
      robots = loadRobots(origin, budget);
      robotsByOrigin.set(origin, robots);
    }
    return robots;
  };
  const valid = validate(urls, results);
  // Gentle mode reads one page at a time with a pause, for sites that rate-limit.
  const concurrency = options.gentle ? 1 : options.render ? RENDER_CONCURRENCY : EXTRACT_CONCURRENCY;
  const pauseMs = options.gentle ? GENTLE_PAUSE_MS : 0;

  const run = async (read: (target: Target) => Promise<ExtractResult>) => {
    for (let start = 0; start < valid.length; start += concurrency) {
      await Promise.all(
        valid.slice(start, start + concurrency).map(async (target) => {
          if (budget.remaining() < (options.render ? 3_000 : 0)) {
            results[target.index] = { url: urls[target.index], ok: false, error: "Ran out of time. Try again." };
            return;
          }
          if (!(await robotsFor(target.origin)).isAllowed(target.url)) {
            results[target.index] = { url: urls[target.index], ok: false, error: "Blocked by the site's robots.txt." };
            return;
          }
          results[target.index] = { ...(await read(target)), url: urls[target.index] };
        }),
      );
      if (pauseMs > 0 && start + concurrency < valid.length) await new Promise((r) => setTimeout(r, pauseMs));
    }
  };

  if (!options.render) {
    await run(({ url }) => extractOne(url, budget));
    return results;
  }

  await withBrowser((browser) =>
    run(async ({ url }) => {
      const page = await renderPage(browser, url, budget.remaining() - 1_000, budget.identity);
      if (!page.ok) return { url, ok: false, error: page.error };
      return {
        url,
        ok: true,
        status: page.status,
        finalUrl: page.url,
        ...extractContents(page.html, page.url),
        rendered: true,
        needsRender: false,
      };
    }),
  );
  return results;
}
