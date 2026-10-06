import { Budget, fetchPage, inBatches, type FetchResult } from "./fetcher";
import { sameSite } from "./guard";
import { analyseUrl, BATCH_PAUSE_MS } from "./extract";
import type { PageAnalysis } from "./extract/types";
import { aiBotAccess, parseRobots, type AiBotAccess, type Robots } from "./robots";

const MAX_ROBOTS_TEXT = 20_000;
const SITE_CONCURRENCY = 4;

export type FileCheck = {
  url: string;
  status: number;
  bytes: number;
  present: boolean;
  /** Why it counts as missing, skipped or odd. */
  note: string | null;
};

export type AdsTxt = FileCheck & {
  lines: number;
  direct: number;
  reseller: number;
  domains: string[];
  ownerDomain: string;
  managerDomain: string;
};

export type RequestCheck = {
  url: string;
  status: number;
  finalUrl: string;
  hops: number;
  error: string | null;
};

export type SiteReport = {
  origin: string;
  robots: {
    url: string;
    status: number;
    present: boolean;
    text: string;
    truncated: boolean;
    groups: { agents: string[]; allow: string[]; disallow: string[]; crawlDelay: number | null }[];
    sitemaps: string[];
    aiBots: AiBotAccess[];
  };
  files: {
    adsTxt: AdsTxt;
    appAdsTxt: AdsTxt;
    llmsTxt: FileCheck & { firstLines: string[] };
    securityTxt: FileCheck;
    humansTxt: FileCheck;
    manifest: FileCheck & { name: string };
  };
  host: {
    https: RequestCheck & { redirectsToHttps: boolean };
    canonicalHost: RequestCheck & { requestedHost: string; winner: string; note: string };
    trailingSlash: { withSlash: RequestCheck; withoutSlash: RequestCheck; note: string } | null;
    notFound: RequestCheck & { kind: "real 404" | "soft 404" | "redirect to homepage" | "redirect" | "other"; note: string };
  };
  homepage: PageAnalysis;
  headers: {
    server: string;
    poweredBy: string;
    cacheControl: string;
    age: string;
    xCache: string;
    cfCacheStatus: string;
    vercelCache: string;
    xRobotsTag: string;
    contentSecurityPolicy: boolean;
    strictTransportSecurity: boolean;
  };
  /** URLs skipped because robots.txt disallows them. */
  skippedByRobots: string[];
  /** URLs that answered with a bot-protection challenge. */
  blocked: string[];
};

export function parseAdsTxt(url: string, response: FetchResult): AdsTxt {
  const base = fileCheck(url, response, /^\s*</);
  const out: AdsTxt = { ...base, lines: 0, direct: 0, reseller: 0, domains: [], ownerDomain: "", managerDomain: "" };
  if (!base.present) return out;
  const domains = new Set<string>();
  for (const raw of response.body.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const variable = /^(OWNERDOMAIN|MANAGERDOMAIN|CONTACT|SUBDOMAIN|INVENTORYPARTNERDOMAIN)\s*=\s*(.+)$/i.exec(line);
    if (variable) {
      if (variable[1].toUpperCase() === "OWNERDOMAIN") out.ownerDomain = variable[2].trim();
      if (variable[1].toUpperCase() === "MANAGERDOMAIN") out.managerDomain = variable[2].trim();
      continue;
    }
    const fields = line.split(",").map((field) => field.trim());
    if (fields.length < 3) continue;
    out.lines++;
    domains.add(fields[0].toLowerCase());
    const relation = fields[2].toUpperCase();
    if (relation === "DIRECT") out.direct++;
    else if (relation === "RESELLER") out.reseller++;
  }
  out.domains = [...domains].sort();
  return out;
}

/** A root file counts as present when it answers 200 with a non-HTML body. */
function fileCheck(url: string, response: FetchResult | null, htmlBody = /^\s*<(?:!doctype|html)/i): FileCheck {
  if (!response) return { url, status: 0, bytes: 0, present: false, note: "Skipped: robots.txt disallows it." };
  if (response.error) return { url, status: 0, bytes: 0, present: false, note: response.error };
  if (response.blocked) return { url, status: response.status, bytes: response.bytes, present: false, note: "Blocked by bot protection." };
  const type = response.headers["content-type"] ?? "";
  const html = /text\/html/i.test(type) || htmlBody.test(response.body);
  if (response.status !== 200) return { url, status: response.status, bytes: response.bytes, present: false, note: `Status ${response.status}.` };
  if (html) return { url, status: 200, bytes: response.bytes, present: false, note: "Returned an HTML page instead (soft 404)." };
  return { url, status: 200, bytes: response.bytes, present: true, note: null };
}

function requestCheck(url: string, response: FetchResult | null): RequestCheck {
  if (!response) return { url, status: 0, finalUrl: url, hops: 0, error: "Skipped: robots.txt disallows it." };
  return {
    url,
    status: response.status,
    finalUrl: response.offHostRedirect ?? response.finalUrl,
    hops: response.redirectChain.length,
    error: response.error,
  };
}

function hostOfUrl(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function slashVariants(sampleUrl: string): { withSlash: string; withoutSlash: string } | null {
  try {
    const url = new URL(sampleUrl);
    if (url.pathname === "/" || /\.[a-z0-9]{2,5}$/i.test(url.pathname)) return null;
    const bare = url.pathname.replace(/\/+$/, "");
    const withSlash = new URL(url.href);
    withSlash.pathname = `${bare}/`;
    const withoutSlash = new URL(url.href);
    withoutSlash.pathname = bare;
    return { withSlash: withSlash.href, withoutSlash: withoutSlash.href };
  } catch {
    return null;
  }
}

/**
 * Site-level checks: robots.txt, root files, host behaviour and a full
 * homepage analysis. robots.txt is read first and every other URL is
 * checked against it. At most 4 requests are in flight, with a pause
 * between batches, and nothing outside the mapped site is fetched.
 */
export async function checkSite(input: {
  origin: string;
  patterns: readonly string[];
  sampleUrl: string | null;
  budget?: Budget;
}): Promise<SiteReport> {
  const budget = input.budget ?? new Budget();
  const origin = input.origin.replace(/\/$/, "");
  const siteHost = hostOfUrl(origin);
  const allowHost = (host: string) => sameSite(host, siteHost);
  const skippedByRobots: string[] = [];
  const blocked: string[] = [];

  // robots.txt first: it decides what else may be fetched.
  const robotsUrl = `${origin}/robots.txt`;
  const robotsResponse = await fetchPage(robotsUrl, { budget, allowHost });
  const robotsPresent =
    !robotsResponse.error && robotsResponse.status === 200 && !/text\/html/i.test(robotsResponse.headers["content-type"] ?? "");
  const robotsText = robotsPresent ? robotsResponse.body : "";
  const robots: Robots = parseRobots(robotsText, origin);
  if (robotsResponse.blocked) blocked.push(robotsUrl);

  const guarded = async (url: string): Promise<FetchResult | null> => {
    if (!robots.isAllowed(url)) {
      skippedByRobots.push(url);
      return null;
    }
    const response = await fetchPage(url, { budget, allowHost });
    if (response.blocked) blocked.push(url);
    return response;
  };

  const otherHost = siteHost.startsWith("www.") ? siteHost.slice(4) : `www.${siteHost}`;
  const protocol = new URL(origin).protocol;
  const slash = input.sampleUrl ? slashVariants(input.sampleUrl) : null;
  const probe = `${origin}/sitemapper-check-${Math.random().toString(36).slice(2, 10)}`;

  // Homepage analysis counts as one slot in the first batch.
  const tasks: { key: string; run: () => Promise<unknown> }[] = [
    {
      key: "homepage",
      run: () => analyseUrl(`${origin}/`, { pattern: "/", patterns: input.patterns, robots, siteHost, budget }),
    },
    { key: "ads", run: () => guarded(`${origin}/ads.txt`) },
    { key: "appAds", run: () => guarded(`${origin}/app-ads.txt`) },
    { key: "llms", run: () => guarded(`${origin}/llms.txt`) },
    { key: "security", run: () => guarded(`${origin}/.well-known/security.txt`) },
    { key: "humans", run: () => guarded(`${origin}/humans.txt`) },
    { key: "http", run: () => guarded(`http://${siteHost}/`) },
    { key: "otherHost", run: () => guarded(`${protocol}//${otherHost}/`) },
    { key: "notFound", run: () => guarded(probe) },
  ];
  if (slash) {
    tasks.push({ key: "withSlash", run: () => guarded(slash.withSlash) });
    tasks.push({ key: "withoutSlash", run: () => guarded(slash.withoutSlash) });
  }
  const done = await inBatches(tasks, SITE_CONCURRENCY, BATCH_PAUSE_MS, (task) => task.run());
  const results = Object.fromEntries(tasks.map((task, index) => [task.key, done[index]])) as Record<string, unknown>;
  const homepage = results.homepage as PageAnalysis;
  const get = (key: string) => (results[key] as FetchResult | null | undefined) ?? null;
  if (homepage.outcome === "blocked") blocked.push(homepage.url);
  if (homepage.outcome === "robots") skippedByRobots.push(homepage.url);

  // Manifest linked from the homepage, fetched only when it's on the site.
  const manifestUrl = homepage.data?.head.manifest ?? "";
  let manifest: SiteReport["files"]["manifest"] = {
    url: manifestUrl,
    status: 0,
    bytes: 0,
    present: false,
    note: manifestUrl ? null : "No manifest linked from the homepage.",
    name: "",
  };
  if (manifestUrl && !allowHost(hostOfUrl(manifestUrl))) {
    manifest.note = "Linked on another host; recorded, not fetched.";
  } else if (manifestUrl) {
    const response = await guarded(manifestUrl);
    const check = fileCheck(manifestUrl, response);
    let name = "";
    if (check.present && response) {
      try {
        const json = JSON.parse(response.body) as { name?: string; short_name?: string };
        name = json.name ?? json.short_name ?? "";
      } catch {
        check.note = "Not valid JSON.";
      }
    }
    manifest = { ...check, name };
  }

  // Host behaviour.
  const http = get("http");
  const httpsCheck = { ...requestCheck(`http://${siteHost}/`, http), redirectsToHttps: false };
  httpsCheck.redirectsToHttps = Boolean(http && !http.error && httpsCheck.finalUrl.startsWith("https:"));

  const other = get("otherHost");
  const homeFinalHost = hostOfUrl(homepage.offHostRedirect ?? homepage.finalUrl) || siteHost;
  const otherCheck = requestCheck(`${protocol}//${otherHost}/`, other);
  const otherFinalHost = hostOfUrl(otherCheck.finalUrl);
  let winner = "unknown";
  let note = "";
  if (other?.errorKind === "network" || other?.errorKind === "private") {
    winner = homeFinalHost.startsWith("www.") ? "www" : "bare domain";
    note = `${otherHost} doesn't respond.`;
  } else if (other && !other.error) {
    if (otherFinalHost === homeFinalHost && otherCheck.hops > 0) {
      winner = homeFinalHost.startsWith("www.") ? "www" : "bare domain";
      note = `${otherHost} redirects to ${homeFinalHost} in ${otherCheck.hops} ${otherCheck.hops === 1 ? "hop" : "hops"}.`;
    } else if (otherFinalHost === otherHost && other.status === 200) {
      winner = "both serve pages";
      note = `Both ${siteHost} and ${otherHost} answer 200 without redirecting.`;
    } else {
      winner = otherFinalHost.startsWith("www.") ? "www" : "bare domain";
      note = `${otherHost} ends at ${otherCheck.finalUrl} (status ${otherCheck.status}).`;
    }
  }
  if (homeFinalHost !== siteHost) {
    note = `${siteHost} redirects to ${homeFinalHost}. ${note}`.trim();
  }

  let trailingSlash: SiteReport["host"]["trailingSlash"] = null;
  if (slash) {
    const withSlash = requestCheck(slash.withSlash, get("withSlash"));
    const withoutSlash = requestCheck(slash.withoutSlash, get("withoutSlash"));
    let slashNote: string;
    if (withSlash.hops > 0 && withSlash.finalUrl === slash.withoutSlash) slashNote = "The trailing-slash form redirects to the form without a slash.";
    else if (withoutSlash.hops > 0 && withoutSlash.finalUrl === slash.withSlash) slashNote = "The form without a slash redirects to the trailing-slash form.";
    else if (withSlash.status === 200 && withoutSlash.status === 200) slashNote = "Both forms answer 200 without redirecting (duplicate URLs).";
    else slashNote = `With slash: status ${withSlash.status}. Without: status ${withoutSlash.status}.`;
    trailingSlash = { withSlash, withoutSlash, note: slashNote };
  }

  const notFoundResponse = get("notFound");
  const notFoundCheck = requestCheck(probe, notFoundResponse);
  let kind: SiteReport["host"]["notFound"]["kind"] = "other";
  let notFoundNote = "";
  if (notFoundResponse && !notFoundResponse.error) {
    const finalPath = (() => {
      try {
        return new URL(notFoundCheck.finalUrl).pathname;
      } catch {
        return "";
      }
    })();
    if (notFoundCheck.status === 404 || notFoundCheck.status === 410) {
      kind = "real 404";
      notFoundNote = `A made-up URL returns ${notFoundCheck.status}.`;
    } else if (notFoundCheck.hops > 0 && finalPath === "/") {
      kind = "redirect to homepage";
      notFoundNote = "A made-up URL redirects to the homepage.";
    } else if (notFoundCheck.hops > 0) {
      kind = "redirect";
      notFoundNote = `A made-up URL redirects to ${notFoundCheck.finalUrl}.`;
    } else if (notFoundCheck.status === 200) {
      kind = "soft 404";
      notFoundNote = "A made-up URL returns 200 (soft 404).";
    } else {
      notFoundNote = `A made-up URL returns ${notFoundCheck.status}.`;
    }
  } else {
    notFoundNote = notFoundCheck.error ?? "Not checked.";
  }

  const h = homepage.headers;
  const llms = get("llms");
  const llmsCheck = fileCheck(`${origin}/llms.txt`, llms);

  return {
    origin,
    robots: {
      url: robotsUrl,
      status: robotsResponse.status,
      present: robotsPresent,
      text: robotsText.slice(0, MAX_ROBOTS_TEXT),
      truncated: robotsText.length > MAX_ROBOTS_TEXT,
      groups: robots.groups.map((group) => ({
        agents: group.agents,
        allow: group.rules.filter((rule) => rule.allow).map((rule) => rule.path).slice(0, 100),
        disallow: group.rules.filter((rule) => !rule.allow).map((rule) => rule.path).slice(0, 100),
        crawlDelay: group.crawlDelay,
      })),
      sitemaps: robots.sitemaps,
      aiBots: aiBotAccess(robots),
    },
    files: {
      adsTxt: parseAdsTxt(`${origin}/ads.txt`, get("ads") ?? robotsSkip(`${origin}/ads.txt`)),
      appAdsTxt: parseAdsTxt(`${origin}/app-ads.txt`, get("appAds") ?? robotsSkip(`${origin}/app-ads.txt`)),
      llmsTxt: {
        ...llmsCheck,
        firstLines: llmsCheck.present && llms ? llms.body.split(/\r?\n/).slice(0, 20).map((line) => line.slice(0, 300)) : [],
      },
      securityTxt: fileCheck(`${origin}/.well-known/security.txt`, get("security")),
      humansTxt: fileCheck(`${origin}/humans.txt`, get("humans")),
      manifest,
    },
    host: {
      https: httpsCheck,
      canonicalHost: { ...otherCheck, requestedHost: otherHost, winner, note },
      trailingSlash,
      notFound: { ...notFoundCheck, kind, note: notFoundNote },
    },
    homepage,
    headers: {
      server: h.server ?? "",
      poweredBy: h["x-powered-by"] ?? "",
      cacheControl: h["cache-control"] ?? "",
      age: h.age ?? "",
      xCache: h["x-cache"] ?? "",
      cfCacheStatus: h["cf-cache-status"] ?? "",
      vercelCache: h["x-vercel-cache"] ?? "",
      xRobotsTag: h["x-robots-tag"] ?? "",
      contentSecurityPolicy: Boolean(h["content-security-policy"]),
      strictTransportSecurity: Boolean(h["strict-transport-security"]),
    },
    skippedByRobots,
    blocked,
  };
}

/** A stand-in response for a file robots.txt told us not to fetch. */
function robotsSkip(url: string): FetchResult {
  return {
    url,
    finalUrl: url,
    status: 0,
    headers: {},
    body: "",
    redirectChain: [],
    ms: 0,
    bytes: 0,
    truncated: false,
    blocked: false,
    error: "Skipped: robots.txt disallows it.",
    errorKind: null,
    offHostRedirect: null,
    retryAfter: null,
  };
}
