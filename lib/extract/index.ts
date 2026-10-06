import { BOT_PROTECTION_MESSAGE, Budget, fetchPage, inBatches } from "../fetcher";
import { sameSite } from "../guard";
import { isAffiliatePath } from "../affiliate";
import type { Robots } from "../robots";
import { allElements, byTag, documentOrder, inlineText, parseDocument, visibleText } from "./dom";
import { analyseHead } from "./head";
import { analyseLinks } from "./links";
import { detectNiche } from "./niche";
import { analysePerf } from "./perf";
import { analyseSchema } from "./schema";
import { analyseSignals } from "./signals";
import { analyseStructure } from "./structure";
import { analyseTech } from "./tech";
import type { PageAnalysis, PageData } from "./types";

export type { PageAnalysis, PageData } from "./types";

/** Pages fetched at once by one analysis request. Two requests run at a time, so never more than 4. */
export const ANALYSE_CONCURRENCY = 2;
export const BATCH_PAUSE_MS = 300;

/** Analyses one HTML document. Pure: no network. */
export function analyseHtml(
  html: string,
  input: { url: string; headers?: Record<string, string>; patterns?: readonly string[]; ms?: number; bytes?: number },
): PageData {
  const headers = input.headers ?? {};
  const root = parseDocument(html);
  const elements = allElements(root);
  const order = documentOrder(root);
  const body = byTag(elements, "body")[0] ?? root;
  const pageText = visibleText(body);

  const head = analyseHead(elements, input.url, headers);
  const schema = analyseSchema(elements, pageText);
  const { structure, mainText } = analyseStructure(root, elements, html, input.url, schema);
  const links = analyseLinks(elements, input.url, input.patterns ?? []);
  const tech = analyseTech(elements, html, headers, input.url, structure.main.words);
  const signals = analyseSignals(elements, order, pageText, schema, tech.thirdParties);
  const h1 = byTag(elements, "h1")[0];
  const niche = detectNiche({
    text: mainText || pageText,
    title: head.title,
    h1: h1 ? inlineText(h1) : "",
    url: input.url,
    schemaTypes: schema.types,
    tech: [...tech.cms, ...tech.frameworks].map((item) => item.name),
  });
  const perf = analysePerf(elements, {
    pageUrl: input.url,
    htmlBytes: input.bytes ?? Buffer.byteLength(html),
    responseMs: input.ms ?? 0,
  });
  return { head, schema, structure, links, tech, signals, niche, perf };
}

function looksLikeHtml(contentType: string, body: string): boolean {
  if (/html|xhtml/i.test(contentType)) return true;
  if (contentType && !/text\/plain|octet-stream/i.test(contentType)) return false;
  return /^\s*(?:<!doctype html|<html)/i.test(body);
}

/**
 * Fetches and analyses one page on the mapped site. robots.txt is checked
 * first; redirects that leave the site are recorded, not followed.
 */
export async function analyseUrl(
  url: string,
  options: { pattern: string; patterns: readonly string[]; robots: Robots; siteHost: string; budget: Budget },
): Promise<PageAnalysis> {
  const base: PageAnalysis = {
    url,
    pattern: options.pattern,
    finalUrl: url,
    status: 0,
    outcome: "ok",
    message: null,
    redirectChain: [],
    offHostRedirect: null,
    ms: 0,
    bytes: 0,
    truncated: false,
    headers: {},
    data: null,
  };
  if (isAffiliatePath(url)) {
    return { ...base, outcome: "affiliate", message: "Affiliate redirect path: recorded, not requested." };
  }
  if (!options.robots.isAllowed(url)) {
    return { ...base, outcome: "robots", message: "Skipped: robots.txt disallows this URL for SitemapperBot." };
  }
  const response = await fetchPage(url, {
    budget: options.budget,
    accept: "html",
    allowHost: (host) => sameSite(host, options.siteHost),
  });
  const result: PageAnalysis = {
    ...base,
    finalUrl: response.finalUrl,
    status: response.status,
    redirectChain: response.redirectChain,
    offHostRedirect: response.offHostRedirect,
    ms: response.ms,
    bytes: response.bytes,
    truncated: response.truncated,
    headers: response.headers,
  };
  if (response.error) return { ...result, outcome: "error", message: response.error };
  if (response.offHostRedirect) {
    return {
      ...result,
      outcome: "off-host",
      message: `Redirects off the site to ${response.offHostRedirect}. Recorded, not followed.`,
    };
  }
  if (response.blocked) return { ...result, outcome: "blocked", message: BOT_PROTECTION_MESSAGE(url) };
  if (response.status >= 400) {
    return { ...result, outcome: "error", message: `The page returned status ${response.status}.` };
  }
  if (!looksLikeHtml(response.headers["content-type"] ?? "", response.body)) {
    return { ...result, outcome: "not-html", message: `Not an HTML page (${response.headers["content-type"] || "no content type"}).` };
  }
  try {
    result.data = analyseHtml(response.body, {
      url: response.finalUrl,
      headers: response.headers,
      patterns: options.patterns,
      ms: response.ms,
      bytes: response.bytes,
    });
  } catch (error) {
    return { ...result, outcome: "error", message: `The page couldn't be analysed (${error instanceof Error ? error.message : "unknown error"}).` };
  }
  return result;
}

/** Analyses several pages, two at a time with a pause between batches. */
export async function analyseUrls(
  urls: string[],
  options: { pattern: string; patterns: readonly string[]; robots: Robots; siteHost: string; budget: Budget },
): Promise<PageAnalysis[]> {
  return inBatches(urls, ANALYSE_CONCURRENCY, BATCH_PAUSE_MS, (url) => analyseUrl(url, options));
}
