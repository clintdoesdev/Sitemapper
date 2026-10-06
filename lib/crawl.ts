import { isAffiliatePath } from "./affiliate";
import { blockedHostReason, sameSite } from "./guard";
import { Budget, fetchText, TIME_BUDGET_MS, type Identity } from "./fetcher";
import { parseRobots, type Robots } from "./robots";

export { blockedHostReason } from "./guard";
export { Budget, fetchText, type Identity } from "./fetcher";
export { parseRobots, type Robots } from "./robots";

const MAX_SITEMAPS = 60;
const MAX_URLS = 50_000;
const SITEMAP_CONCURRENCY = 4;
const CRAWL_CONCURRENCY = 4;
const CRAWL_PAUSE_MS = 300;
const MAX_CRAWL_PAGES = 300;
const MAX_RENDER_CRAWL_PAGES = 40;
const RENDER_CRAWL_CONCURRENCY = 3;
const MIN_RENDER_BUDGET_MS = 8_000;
/** Sitemaps can hold 50,000 URLs, so they get a bigger cap than pages. */
const MAX_SITEMAP_BYTES = 60 * 1024 * 1024;
const DEFAULT_SITEMAP_PATHS = ["/sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml", "/wp-sitemap.xml"];
const ASSET_EXTENSIONS =
  /\.(?:png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|css|js|mjs|map|json|xml|gz|txt|pdf|zip|rar|woff2?|ttf|otf|eot|mp3|mp4|m4a|m4v|webm|ogg|ogv|wav|mov|avi|wmv|flv)$/i;

export type SitemapStat = {
  url: string;
  kind: "index" | "urlset";
  /** Page URLs (urlset) or child sitemaps (index) listed. */
  urls: number;
  withLastmod: number;
  oldestLastmod: string | null;
  newestLastmod: string | null;
  distinctLastmod: number;
  extensions: { image: boolean; video: boolean; news: boolean; hreflang: boolean };
  /** 90% or more of entries share one lastmod value. */
  autoLastmod: boolean;
};

export type CrawlResult = {
  origin: string;
  source: "sitemap" | "crawl";
  sitemaps: string[];
  sitemapStats: SitemapStat[];
  urls: string[];
  /** lastmod per page URL, as an ISO date, when the sitemap gave one. */
  lastmod: Map<string, string>;
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

function plural(count: number, word: string): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? word : `${word}s`}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export type SitemapEntry = { loc: string; lastmod: string | null };

export type ParsedSitemap = {
  kind: "index" | "urlset";
  entries: SitemapEntry[];
  extensions: SitemapStat["extensions"];
};

/** Normalises a lastmod value to an ISO timestamp, or null when it isn't a date. */
export function normaliseLastmod(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const time = Date.parse(trimmed);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function firstTag(block: string, tag: string): string | null {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}\\s*>`, "i").exec(block);
  return match ? decodeEntities(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim() : null;
}

/**
 * Parses a sitemap document (regex based). Returns null when it is neither a
 * <urlset> nor a <sitemapindex>. Namespaced tags like <image:loc> are ignored.
 */
export function parseSitemap(xml: string): ParsedSitemap | null {
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  const isUrlset = /<urlset[\s>]/i.test(xml);
  if (!isIndex && !isUrlset) return null;
  const blockTag = isIndex ? "sitemap" : "url";
  const entries: SitemapEntry[] = [];
  const blocks = new RegExp(`<${blockTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${blockTag}\\s*>`, "gi");
  for (const match of xml.matchAll(blocks)) {
    const loc = firstTag(match[1], "loc");
    const url = loc ? toHttpUrl(loc) : null;
    if (!url) continue;
    const lastmod = firstTag(match[1], "lastmod");
    entries.push({ loc: url, lastmod: lastmod ? normaliseLastmod(lastmod) : null });
  }
  // Fall back to bare <loc> tags for malformed documents.
  if (entries.length === 0) for (const loc of extractLocs(xml)) entries.push({ loc, lastmod: null });
  return {
    kind: isIndex ? "index" : "urlset",
    entries,
    extensions: {
      image: /<image:/i.test(xml),
      video: /<video:/i.test(xml),
      news: /<news:/i.test(xml),
      hreflang: /<xhtml:link\b/i.test(xml),
    },
  };
}

/** Per-sitemap statistics, including whether lastmod looks auto-generated. */
export function sitemapStat(url: string, parsed: ParsedSitemap): SitemapStat {
  const dated = parsed.entries.map((entry) => entry.lastmod).filter((value): value is string => value !== null);
  const counts = new Map<string, number>();
  for (const value of dated) counts.set(value, (counts.get(value) ?? 0) + 1);
  const top = Math.max(0, ...counts.values());
  const sorted = [...dated].sort();
  return {
    url,
    kind: parsed.kind,
    urls: parsed.entries.length,
    withLastmod: dated.length,
    oldestLastmod: sorted[0] ?? null,
    newestLastmod: sorted[sorted.length - 1] ?? null,
    distinctLastmod: counts.size,
    extensions: parsed.extensions,
    autoLastmod: dated.length >= 5 && top / dated.length >= 0.9,
  };
}

type SitemapState = {
  sitemaps: string[];
  stats: SitemapStat[];
  urls: Set<string>;
  lastmod: Map<string, string>;
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

    const responses = await Promise.all(batch.map((url) => fetchText(url, budget, { maxBytes: MAX_SITEMAP_BYTES })));
    responses.forEach((response, index) => {
      if (!response.ok || response.status >= 400) return;
      const parsed = parseSitemap(response.text);
      if (!parsed) return;
      state.sitemaps.push(batch[index]);
      state.stats.push(sitemapStat(batch[index], parsed));

      for (const { loc, lastmod } of parsed.entries) {
        if (parsed.kind === "index") {
          if (!tried.has(loc) && !queued.has(loc) && !blockedHostReason(new URL(loc).hostname)) {
            queued.add(loc);
            queue.push(loc);
          }
        } else if (state.urls.size < MAX_URLS) {
          state.urls.add(loc);
          if (lastmod) state.lastmod.set(loc, lastmod);
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
    // Affiliate redirect paths are never requested.
    if (isAffiliatePath(url)) return;
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
        const response = await fetchText(url, budget, {
          allowHost: (host) => sameSite(host, new URL(url).hostname),
        });
        if (!response.ok) {
          return {
            ok: false,
            detail: response.reason === "timeout" ? "it took longer than 10 seconds to respond" : "the request failed",
          };
        }
        if (!sameSite(new URL(response.url).hostname, new URL(url).hostname)) {
          return { ok: false, detail: `it redirects to another site (${new URL(response.url).hostname})` };
        }
        if (response.botProtection) return { ok: false, detail: "the site's bot protection answered instead" };
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
                const page = await renderPage(browser, url, budget.remaining() - 1_000, budget.identity);
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

export async function mapSite(origin: string, identity: Identity = "bot", budgetMs?: number): Promise<CrawlResult> {
  const budget = new Budget(budgetMs, identity);
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

  const state: SitemapState = { sitemaps: [], stats: [], urls: new Set(), lastmod: new Map(), truncated: false, notes };
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
      sitemapStats: state.stats,
      urls: [...state.urls],
      lastmod: state.lastmod,
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
    sitemapStats: state.stats,
    urls: crawl.pages,
    lastmod: new Map(),
    truncated: crawl.truncated,
    notes: crawlNotes,
  };
}
