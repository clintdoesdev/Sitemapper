import { gunzipSync } from "node:zlib";

const USER_AGENT = "SitemapperBot/1.0 (site structure study tool)";
const REQUEST_TIMEOUT_MS = 10_000;
const TIME_BUDGET_MS = 50_000;
const MAX_SITEMAPS = 60;
const MAX_URLS = 50_000;
const SITEMAP_CONCURRENCY = 4;
const CRAWL_CONCURRENCY = 4;
const CRAWL_PAUSE_MS = 300;
const MAX_CRAWL_PAGES = 300;
const MAX_RENDER_CRAWL_PAGES = 40;
const RENDER_CRAWL_CONCURRENCY = 3;
const MIN_RENDER_BUDGET_MS = 8_000;
const MAX_BODY_BYTES = 60 * 1024 * 1024;
const DEFAULT_SITEMAP_PATHS = ["/sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml", "/wp-sitemap.xml"];
const ASSET_EXTENSIONS =
  /\.(?:png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|css|js|mjs|map|json|xml|gz|txt|pdf|zip|rar|woff2?|ttf|otf|eot|mp3|mp4|m4a|m4v|webm|ogg|ogv|wav|mov|avi|wmv|flv)$/i;

export type CrawlResult = {
  origin: string;
  source: "sitemap" | "crawl";
  sitemaps: string[];
  urls: string[];
  truncated: boolean;
  notes: string[];
};

/** Input that can't be parsed as a domain or URL. */
export class InvalidDomainError extends Error {}

/** Input that points at a private or local address. */
export class BlockedHostError extends Error {}

/** A failure we can describe to the user, e.g. the site is unreachable. */
export class CrawlError extends Error {}

// ---------------------------------------------------------------------------
// Input normalisation and SSRF guard
// ---------------------------------------------------------------------------

/** Returns an error message if the hostname must not be fetched, otherwise null. */
export function blockedHostReason(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host.startsWith("[") || host.includes(":")) {
    return "IP addresses in IPv6 form aren't supported. Enter the site's domain name instead.";
  }
  if (host === "localhost" || host.endsWith(".localhost")) {
    return "Local addresses can't be mapped. Enter a public domain, like example.com.";
  }
  if (host.endsWith(".local") || host.endsWith(".internal")) {
    return "Internal network addresses can't be mapped. Enter a public domain, like example.com.";
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    const isPrivate =
      a === 127 ||
      a === 10 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 192 && b === 168) ||
      (a === 172 && b >= 16 && b <= 31);
    if (isPrivate) {
      return "Private and local IP addresses can't be mapped. Enter a public domain, like example.com.";
    }
  }
  if (!host.includes(".")) {
    return "That domain is missing its ending, like .com or .co.uk. Enter the full domain.";
  }
  return null;
}

/** Turns user input like "example.com/path" into an origin like "https://example.com". */
export function normalizeDomain(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new InvalidDomainError("Enter a domain, like example.com.");
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new InvalidDomainError("That doesn't look like a valid domain.");
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname) {
    throw new InvalidDomainError("That doesn't look like a valid domain.");
  }
  const reason = blockedHostReason(url.hostname);
  if (reason) throw new BlockedHostError(reason);
  return url.origin;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

type FetchOk = { ok: true; url: string; status: number; contentType: string; text: string };
type FetchFail = { ok: false; reason: "network" | "timeout" | "blocked" };
export type FetchOutcome = FetchOk | FetchFail;

/** A shared deadline for every request made while handling one API call. */
export class Budget {
  private readonly deadline: number;

  constructor(ms: number = TIME_BUDGET_MS) {
    this.deadline = Date.now() + ms;
  }

  remaining(): number {
    return this.deadline - Date.now();
  }

  expired(): boolean {
    return this.remaining() <= 0;
  }
}

export async function fetchText(url: string, budget: Budget): Promise<FetchOutcome> {
  const timeout = Math.min(REQUEST_TIMEOUT_MS, budget.remaining());
  if (timeout <= 0) return { ok: false, reason: "timeout" };
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(timeout),
    });
    // Redirects are followed, so check where we actually ended up.
    if (blockedHostReason(new URL(response.url || url).hostname)) {
      await response.body?.cancel();
      return { ok: false, reason: "blocked" };
    }
    let bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
      bytes = new Uint8Array(gunzipSync(bytes, { maxOutputLength: MAX_BODY_BYTES }));
    }
    return {
      ok: true,
      url: response.url || url,
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      text: new TextDecoder().decode(bytes),
    };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return { ok: false, reason: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
  }
}

function plural(count: number, word: string): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? word : `${word}s`}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

type RobotsRule = { allow: boolean; length: number; regex: RegExp };

export type Robots = {
  sitemaps: string[];
  isAllowed: (url: string) => boolean;
};

function ruleToRegex(path: string): RegExp {
  const anchored = path.endsWith("$");
  const body = anchored ? path.slice(0, -1) : path;
  const source = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}${anchored ? "$" : ""}`);
}

export function parseRobots(text: string, origin: string): Robots {
  const sitemaps: string[] = [];
  const rules: RobotsRule[] = [];

  let groupAgents: string[] = [];
  let inRules = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const match = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!match) continue;
    const field = match[1].toLowerCase();
    const value = match[2].trim();

    if (field === "sitemap") {
      try {
        sitemaps.push(new URL(value, origin).href);
      } catch {
        // Ignore malformed sitemap lines.
      }
      continue;
    }
    if (field === "user-agent") {
      // A user-agent line after rules starts a new group.
      if (inRules) {
        groupAgents = [];
        inRules = false;
      }
      groupAgents.push(value.toLowerCase());
      continue;
    }
    if (field === "allow" || field === "disallow") {
      inRules = true;
      if (!groupAgents.includes("*") || !value) continue;
      rules.push({ allow: field === "allow", length: value.length, regex: ruleToRegex(value) });
    }
  }

  const isAllowed = (url: string): boolean => {
    let path: string;
    try {
      const parsed = new URL(url);
      path = parsed.pathname + parsed.search;
    } catch {
      return false;
    }
    let best: RobotsRule | null = null;
    for (const rule of rules) {
      if (!rule.regex.test(path)) continue;
      // Longest match wins; on a tie, Allow wins.
      if (!best || rule.length > best.length || (rule.length === best.length && rule.allow)) {
        best = rule;
      }
    }
    return best ? best.allow : true;
  };

  return { sitemaps: [...new Set(sitemaps)], isAllowed };
}

// ---------------------------------------------------------------------------
// Sitemaps
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "\u2013",
  mdash: "\u2014",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
  hellip: "\u2026",
  middot: "\u00b7",
  bull: "\u2022",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  euro: "\u20ac",
  pound: "\u00a3",
  times: "\u00d7",
  laquo: "\u00ab",
  raquo: "\u00bb",
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#")) {
      const code = lower.startsWith("#x") ? parseInt(lower.slice(2), 16) : parseInt(lower.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[lower] ?? whole;
  });
}

export function toHttpUrl(value: string, base?: string): string | null {
  try {
    const url = new URL(value, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

/** Extracts <loc> values. Namespaced tags like <image:loc> don't match. */
export function extractLocs(xml: string): string[] {
  const locs: string[] = [];
  const pattern = /<loc(?:\s[^>]*)?>([\s\S]*?)<\/loc\s*>/gi;
  for (const match of xml.matchAll(pattern)) {
    const raw = match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
    const url = toHttpUrl(decodeEntities(raw));
    if (url) locs.push(url);
  }
  return locs;
}

type SitemapState = {
  sitemaps: string[];
  urls: Set<string>;
  truncated: boolean;
  notes: string[];
};

async function readSitemaps(seeds: string[], budget: Budget, state: SitemapState, tried: Set<string>) {
  const queue = [...new Set(seeds)].filter((seed) => !tried.has(seed));
  const queued = new Set(queue);
  let hitSitemapLimit = false;
  let hitTimeLimit = false;

  while (queue.length > 0 && state.urls.size < MAX_URLS) {
    if (budget.expired()) {
      hitTimeLimit = true;
      break;
    }
    if (tried.size >= MAX_SITEMAPS) {
      hitSitemapLimit = true;
      break;
    }
    const batch = queue.splice(0, Math.min(SITEMAP_CONCURRENCY, MAX_SITEMAPS - tried.size));
    batch.forEach((url) => tried.add(url));

    const responses = await Promise.all(batch.map((url) => fetchText(url, budget)));
    responses.forEach((response, index) => {
      if (!response.ok || response.status >= 400) return;
      const { text } = response;
      const isIndex = /<sitemapindex[\s>]/i.test(text);
      const isUrlset = /<urlset[\s>]/i.test(text);
      if (!isIndex && !isUrlset) return;
      state.sitemaps.push(batch[index]);

      for (const loc of extractLocs(text)) {
        if (isIndex) {
          if (!tried.has(loc) && !queued.has(loc) && !blockedHostReason(new URL(loc).hostname)) {
            queued.add(loc);
            queue.push(loc);
          }
        } else if (state.urls.size < MAX_URLS) {
          state.urls.add(loc);
        } else {
          state.truncated = true;
          break;
        }
      }
    });
    if (budget.expired() && queue.length > 0) hitTimeLimit = true;
  }

  if (state.urls.size >= MAX_URLS) {
    state.truncated = true;
    state.notes.push(`Stopped at ${MAX_URLS.toLocaleString("en-US")} URLs, so some pages aren't listed.`);
  }
  if (hitSitemapLimit) {
    state.truncated = true;
    const skipped = queue.length;
    state.notes.push(
      `Stopped after reading ${MAX_SITEMAPS} sitemaps. ${skipped.toLocaleString("en-US")} more ${
        skipped === 1 ? "sitemap was" : "sitemaps were"
      } listed but not read.`,
    );
  }
  if (hitTimeLimit) {
    state.truncated = true;
    state.notes.push(`Stopped after ${TIME_BUDGET_MS / 1000} seconds, so some sitemaps weren't read.`);
  }
}

// ---------------------------------------------------------------------------
// Fallback crawl
// ---------------------------------------------------------------------------

function bareHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function extractLinks(html: string, pageUrl: string): string[] {
  const baseMatch = /<base\s[^>]*href\s*=\s*["']([^"']+)["']/i.exec(html);
  const base = (baseMatch && toHttpUrl(decodeEntities(baseMatch[1]), pageUrl)) || pageUrl;
  const links: string[] = [];
  const pattern = /<a\s[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
  for (const match of html.matchAll(pattern)) {
    const href = decodeEntities((match[1] ?? match[2] ?? match[3] ?? "").trim());
    if (!href || /^(?:mailto|tel|javascript|data|sms):/i.test(href)) continue;
    const url = toHttpUrl(href, base);
    if (url) links.push(url);
  }
  return links;
}

/** Rough count of visible words in an HTML document. */
function visibleWordCount(html: string): number {
  const text = html
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return (decodeEntities(text).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
}

/** True when HTML is a JavaScript shell: almost no text, but scripts that would build it. */
export function looksJavaScriptBuilt(html: string, wordCount = visibleWordCount(html)): boolean {
  return wordCount < 80 && /<script\b[^>]*\bsrc\s*=/i.test(html);
}

type PageRead = { ok: true; url: string; html: string } | { ok: false; detail: string };

type CrawlMode = {
  read: (urls: string[]) => Promise<PageRead[]>;
  maxPages: number;
  concurrency: number;
  pauseMs: number;
};

async function followLinks(origin: string, robots: Robots, budget: Budget, mode: CrawlMode) {
  const pages: string[] = [];
  const siteHost = bareHost(new URL(origin).hostname);
  const homepage = `${origin}/`;
  const seen = new Set<string>([homepage]);
  const queue: string[] = [homepage];
  let fetched = 0;
  let homepageFailure: string | null = null;
  let homepageIsShell = false;
  let stoppedByTime = false;

  const enqueue = (url: string) => {
    const parsed = new URL(url);
    if (bareHost(parsed.hostname) !== siteHost) return;
    if (ASSET_EXTENSIONS.test(parsed.pathname)) return;
    if (seen.has(url) || !robots.isAllowed(url)) return;
    seen.add(url);
    queue.push(url);
  };

  while (queue.length > 0 && fetched < mode.maxPages) {
    if (budget.remaining() < 1_000) {
      stoppedByTime = true;
      break;
    }
    const batch = queue.splice(0, Math.min(mode.concurrency, mode.maxPages - fetched));
    fetched += batch.length;
    const reads = await mode.read(batch);

    reads.forEach((read, index) => {
      const isHomepage = batch[index] === homepage;
      if (!read.ok) {
        if (isHomepage) homepageFailure = read.detail;
        return;
      }
      const finalUrl = toHttpUrl(read.url) ?? batch[index];
      if (bareHost(new URL(finalUrl).hostname) !== siteHost) return;
      if (isHomepage) homepageIsShell = looksJavaScriptBuilt(read.html);
      seen.add(finalUrl);
      if (!pages.includes(finalUrl)) pages.push(finalUrl);
      for (const link of extractLinks(read.html, finalUrl)) enqueue(link);
    });

    if (queue.length > 0 && fetched < mode.maxPages && mode.pauseMs > 0) await sleep(mode.pauseMs);
  }

  return {
    pages,
    homepageFailure: homepageFailure as string | null,
    homepageIsShell,
    truncated: queue.length > 0,
    stoppedByTime,
  };
}

function readWithFetch(budget: Budget) {
  return (urls: string[]) =>
    Promise.all(
      urls.map(async (url): Promise<PageRead> => {
        const response = await fetchText(url, budget);
        if (!response.ok) {
          return {
            ok: false,
            detail: response.reason === "timeout" ? "it took longer than 10 seconds to respond" : "the request failed",
          };
        }
        if (response.status >= 400) return { ok: false, detail: `it returned status ${response.status}` };
        if (!/text\/html|application\/xhtml\+xml/i.test(response.contentType)) {
          return { ok: false, detail: "it didn't return an HTML page" };
        }
        return { ok: true, url: response.url, html: response.text };
      }),
    );
}

async function crawlSite(origin: string, robots: Robots, budget: Budget) {
  const notes: string[] = [];
  const homepage = `${origin}/`;

  if (!robots.isAllowed(homepage)) {
    notes.push("The site's robots.txt doesn't allow crawling its homepage, so no links were followed.");
    return { pages: [] as string[], truncated: false, notes, rendered: false };
  }

  const plain = await followLinks(origin, robots, budget, {
    read: readWithFetch(budget),
    maxPages: MAX_CRAWL_PAGES,
    concurrency: CRAWL_CONCURRENCY,
    pauseMs: CRAWL_PAUSE_MS,
  });

  // A JavaScript-built homepage, or one that refuses plain requests, gets a
  // second pass in a real browser so its scripts can run.
  const tryBrowser =
    (plain.homepageFailure !== null || (plain.homepageIsShell && plain.pages.length <= 3)) &&
    budget.remaining() > MIN_RENDER_BUDGET_MS;

  if (tryBrowser) {
    try {
      const { renderPage, withBrowser } = await import("./render");
      const rendered = await withBrowser((browser) =>
        followLinks(origin, robots, budget, {
          read: (urls) =>
            Promise.all(
              urls.map(async (url): Promise<PageRead> => {
                const page = await renderPage(browser, url, budget.remaining() - 1_000);
                return page.ok
                  ? { ok: true, url: page.url, html: page.html }
                  : { ok: false, detail: page.error.replace(/\.$/, "").toLowerCase() };
              }),
            ),
          maxPages: MAX_RENDER_CRAWL_PAGES,
          concurrency: RENDER_CRAWL_CONCURRENCY,
          pauseMs: 0,
        }),
      );
      if (rendered.pages.length > plain.pages.length) {
        notes.push(
          plain.homepageFailure
            ? `The homepage refused a plain request, so Sitemapper loaded the site in a browser instead and followed links from ${plural(rendered.pages.length, "page")}.`
            : `The homepage builds its content with JavaScript, so Sitemapper ran it in a browser and followed links from ${plural(rendered.pages.length, "page")}.`,
        );
        if (rendered.truncated) {
          notes.push(
            rendered.stoppedByTime
              ? `Stopped after ${TIME_BUDGET_MS / 1000} seconds with links still left to follow, so this is a partial list.`
              : `Browser crawls stop after ${MAX_RENDER_CRAWL_PAGES} pages, so this is a partial list.`,
          );
        }
        return { pages: rendered.pages, truncated: rendered.truncated, notes, rendered: true };
      }
    } catch (error) {
      console.error(error);
      notes.push("Sitemapper tried to load the site in a browser, but the browser couldn't start.");
    }
  }

  if (plain.homepageFailure) {
    notes.push(
      `The homepage couldn't be loaded because ${plain.homepageFailure}. The site probably blocks automated requests, so try another domain.`,
    );
  } else if (plain.homepageIsShell && plain.pages.length <= 3 && !tryBrowser) {
    notes.push("The homepage builds its links with JavaScript, and there wasn't enough time left to run it in a browser.");
  }
  if (plain.truncated) {
    notes.push(
      plain.stoppedByTime
        ? `Stopped after ${TIME_BUDGET_MS / 1000} seconds with links still left to follow, so this is a partial list.`
        : `Stopped after ${MAX_CRAWL_PAGES} pages with links still left to follow, so this is a partial list.`,
    );
  }
  return { pages: plain.pages, truncated: plain.truncated, notes, rendered: false };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function mapSite(origin: string): Promise<CrawlResult> {
  const budget = new Budget();
  const host = new URL(origin).hostname;
  const notes: string[] = [];

  const robotsResponse = await fetchText(`${origin}/robots.txt`, budget);
  if (!robotsResponse.ok && robotsResponse.reason !== "blocked") {
    // Distinguish "site is down or misspelled" from "robots.txt is missing".
    const homepage = await fetchText(`${origin}/`, budget);
    if (!homepage.ok && homepage.reason !== "blocked") {
      throw new CrawlError(
        homepage.reason === "timeout"
          ? `${host} didn't respond within 10 seconds. Check the site is online, then try again.`
          : `Couldn't connect to ${host}. Check the domain is spelled correctly and the site is online.`,
      );
    }
  }
  const robotsText =
    robotsResponse.ok && robotsResponse.status < 400 && !/text\/html/i.test(robotsResponse.contentType)
      ? robotsResponse.text
      : "";
  const robots = parseRobots(robotsText, origin);

  const state: SitemapState = { sitemaps: [], urls: new Set(), truncated: false, notes };
  const tried = new Set<string>();
  const robotsSitemaps = robots.sitemaps.filter((url) => !blockedHostReason(new URL(url).hostname));

  if (robotsSitemaps.length > 0) {
    await readSitemaps(robotsSitemaps, budget, state, tried);
  }
  if (state.urls.size === 0 && !budget.expired()) {
    if (robotsSitemaps.length > 0) {
      notes.push("The sitemaps listed in robots.txt had no pages, so the usual sitemap locations were checked.");
    }
    await readSitemaps(
      DEFAULT_SITEMAP_PATHS.map((path) => `${origin}${path}`),
      budget,
      state,
      tried,
    );
  }

  if (state.urls.size > 0) {
    return {
      origin,
      source: "sitemap",
      sitemaps: state.sitemaps,
      urls: [...state.urls],
      truncated: state.truncated,
      notes,
    };
  }

  const crawl = await crawlSite(origin, robots, budget);
  const crawlNotes = [
    "No sitemap with pages was found, so Sitemapper followed links from the homepage instead. Pages that aren't linked from anywhere won't appear.",
    ...crawl.notes,
  ];
  return {
    origin,
    source: "crawl",
    sitemaps: state.sitemaps,
    urls: crawl.pages,
    truncated: crawl.truncated,
    notes: crawlNotes,
  };
}
