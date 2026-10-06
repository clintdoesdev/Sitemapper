// Run with: npx tsx scripts/selftest.ts   (or: npm run selftest)
// Offline: DNS lookups and fetch are injected, so no request leaves the machine.
import assert from "node:assert/strict";
import { checkHost, clearGuardCache, guardConfig, isPrivateAddress, blockedHostReason } from "../lib/guard";
import { fetchPage, fetcherConfig } from "../lib/fetcher";
import { parseRobots, aiBotAccess } from "../lib/robots";
import { groupByPattern, groupUrls, matchPattern, classifySegment, textTemplate } from "../lib/patterns";
import { mapSite, parseSitemap, sitemapStat } from "../lib/crawl";
import { analyseHtml, analyseUrls } from "../lib/extract";
import { checkSite } from "../lib/site";
import { Budget } from "../lib/fetcher";
import { wordpressPrediction, nextAppRouterPage, clientRenderedShell, cloudflareChallenge } from "./fixtures";
import { POST as analyseRoute } from "../app/api/analyse/route";
import { POST as siteRoute } from "../app/api/site/route";
import { aggregatePattern, buildTemplate, contentEngine, pickSamples, sentenceSkeleton, architectureTree } from "../lib/aggregate";
import { findIssues } from "../lib/issues";
import { buildReport } from "../lib/report";
import type { AnalysisState, PatternResult } from "../lib/analysis-types";
import type { PageAnalysis } from "../lib/extract/types";

type Test = { name: string; run: () => void | Promise<void> };
const tests: Test[] = [];
function test(name: string, run: () => void | Promise<void>) {
  tests.push({ name, run });
}

// ---------------------------------------------------------------------------
// Offline network fixtures
// ---------------------------------------------------------------------------

const dns: Record<string, string[]> = {
  "example.com": ["93.184.215.14"],
  "www.example.com": ["93.184.215.14"],
  "evil.example": ["127.0.0.1"],
  "sneaky.example": ["93.184.215.20", "10.1.2.3"],
  "mapped.example": ["::ffff:192.168.1.10"],
  "v6local.example": ["fd00::1"],
  "tips.example": ["93.184.215.30"],
  "www.tips.example": ["93.184.215.30"],
  "bookie.example": ["93.184.215.40"],
};
guardConfig.lookup = async (host) => {
  const addresses = dns[host];
  if (!addresses) throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
  return addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
};

type Route = { status?: number; body?: string; headers?: Record<string, string> };
let routes: Record<string, Route> = {};
const requested: string[] = [];
fetcherConfig.fetch = async (input) => {
  const url = String(input);
  requested.push(url);
  const route = routes[url];
  if (!route) return new Response("not found", { status: 404, headers: { "content-type": "text/html" } });
  return new Response(route.body ?? "", {
    status: route.status ?? 200,
    headers: { "content-type": "text/html; charset=utf-8", ...(route.headers ?? {}) },
  });
};

function resetNetwork(next: Record<string, Route> = {}) {
  routes = next;
  requested.length = 0;
  clearGuardCache();
}

// ---------------------------------------------------------------------------
// Pattern grouping (the original cases)
// ---------------------------------------------------------------------------

const base = "https://example.com";
function patternCounts(urls: string[]): Record<string, number> {
  return Object.fromEntries(groupByPattern(urls).map((g) => [g.pattern, g.count]));
}

test("grouping: match pages collapse into one template", () => {
  assert.deepEqual(
    patternCounts([
      `${base}/predictions/arsenal-vs-chelsea`,
      `${base}/predictions/liverpool-vs-everton`,
      `${base}/predictions/real-madrid-vs-barcelona`,
      `${base}/predictions/inter-vs-milan`,
    ]),
    { "/predictions/*": 4 },
  );
});

test("grouping: league pages keep the repeated trailing segment", () => {
  const leagues = ["premier-league", "la-liga", "serie-a", "bundesliga", "ligue-1", "eredivisie", "primeira-liga", "championship"];
  const urls = leagues.flatMap((league) => ["table", "fixtures", "results"].map((page) => `${base}/league/${league}/${page}`));
  assert.deepEqual(patternCounts(urls), { "/league/*/table": 8, "/league/*/fixtures": 8, "/league/*/results": 8 });
});

test("grouping: dates become wildcards", () => {
  assert.deepEqual(patternCounts([`${base}/blog/2026/09/slug`]), { "/blog/*/*/*": 1 });
});

test("grouping: short static pages stay literal, long one-off slugs do not", () => {
  assert.deepEqual(
    patternCounts([`${base}/`, `${base}/about`, `${base}/privacy-policy`, `${base}/arsenal-vs-chelsea-prediction-tips-today`]),
    { "/": 1, "/about": 1, "/privacy-policy": 1, "/*": 1 },
  );
});

test("grouping: a section index stays literal when it has child pages", () => {
  assert.deepEqual(patternCounts([`${base}/news-and-match-previews`, `${base}/news-and-match-previews/x`]), {
    "/news-and-match-previews": 1,
    "/news-and-match-previews/*": 1,
  });
});

test("text templates (extract contents feature) still work", () => {
  assert.equal(
    textTemplate([
      "Arsenal vs Chelsea Prediction, Tips & Odds | Tiporacle",
      "Inter vs Milan Prediction, Tips & Odds | Tiporacle",
    ]),
    "{…} vs {…} Prediction, Tips & Odds | Tiporacle",
  );
});

test("matchPattern picks the most specific pattern", () => {
  const patterns = ["/", "/*", "/league/*/*", "/league/*/table", "/predictions/*", "/about"];
  assert.equal(matchPattern("https://example.com/league/epl/table", patterns), "/league/*/table");
  assert.equal(matchPattern("https://example.com/league/epl/fixtures", patterns), "/league/*/*");
  assert.equal(matchPattern("/about", patterns), "/about", "a literal beats /*");
  assert.equal(matchPattern("/contact", patterns), "/*");
  assert.equal(matchPattern("https://example.com/", patterns), "/", "/ only matches the root");
  assert.equal(matchPattern("https://example.com/a/b/c/d", patterns), null);
  assert.equal(matchPattern("https://example.com/predictions/x?ref=1", patterns), "/predictions/*");
});

test("groups carry share, freshness and placeholder kinds", () => {
  const urls = [
    `${base}/predictions/arsenal-vs-chelsea-12-10-2026`,
    `${base}/predictions/lyon-vs-psg-13-10-2026`,
    `${base}/predictions/inter-vs-milan-14-10-2026`,
    `${base}/news/2026/hello`,
    `${base}/news/2025/world`,
  ];
  const lastmod = new Map([[urls[0], "2026-10-12T00:00:00.000Z"], [urls[1], "2026-10-13T00:00:00.000Z"]]);
  const groups = groupUrls(urls, lastmod);
  const predictions = groups.find((group) => group.pattern === "/predictions/*")!;
  assert.equal(predictions.share, 60);
  assert.equal(predictions.lastmodNewest, "2026-10-13T00:00:00.000Z");
  assert.equal(predictions.lastmodCoverage, 67);
  assert.equal(predictions.placeholders[0].kind, "slug with date");
  assert.equal(predictions.placeholders[0].examples.length, 3);
  const news = groups.find((group) => group.pattern === "/news/*/*")!;
  assert.deepEqual(news.placeholders.map((p) => p.kind), ["year", "slug"]);
  assert.equal(classifySegment("2026-10-12", null), "date");
  assert.equal(classifySegment("3", "page"), "page number");
  assert.equal(classifySegment("12345678", null), "id");
  assert.equal(classifySegment("a1b2c3d4", null), "id");
  assert.equal(classifySegment("premier-league", null), "slug");
});

test("sitemaps: lastmod, extensions and auto-generated lastmod", () => {
  const entries = Array.from({ length: 20 }, (_, i) =>
    `<url><loc>https://example.com/p/${i}</loc><lastmod>${i === 0 ? "2026-01-01" : "2026-10-06T10:00:00+00:00"}</lastmod><image:image><image:loc>https://example.com/i.png</image:loc></image:image></url>`,
  ).join("");
  const parsed = parseSitemap(`<?xml version="1.0"?><urlset xmlns:image="x">${entries}</urlset>`)!;
  assert.equal(parsed.kind, "urlset");
  assert.equal(parsed.entries.length, 20);
  assert.equal(parsed.entries[1].lastmod, "2026-10-06T10:00:00.000Z");
  const stat = sitemapStat("https://example.com/sitemap.xml", parsed);
  assert.equal(stat.withLastmod, 20);
  assert.equal(stat.distinctLastmod, 2);
  assert.equal(stat.oldestLastmod, "2026-01-01T00:00:00.000Z");
  assert.equal(stat.extensions.image, true);
  assert.equal(stat.extensions.hreflang, false);
  assert.equal(stat.autoLastmod, true, "19 of 20 share one value");
  const index = parseSitemap("<sitemapindex><sitemap><loc><![CDATA[https://example.com/a.xml?x=1&amp;y=2]]></loc></sitemap></sitemapindex>")!;
  assert.equal(index.kind, "index");
  assert.equal(index.entries[0].loc, "https://example.com/a.xml?x=1&y=2");
  assert.equal(parseSitemap("<html></html>"), null);
});

// ---------------------------------------------------------------------------
// SSRF guard and redirect-safe fetching
// ---------------------------------------------------------------------------

test("guard: private literals are rejected", async () => {
  resetNetwork();
  for (const host of ["127.0.0.1", "10.0.0.5", "169.254.169.254", "[::1]", "100.64.1.1", "0.0.0.0", "localhost"]) {
    assert.ok(await checkHost(host), `${host} should be rejected`);
  }
  assert.equal(await checkHost("example.com"), null);
});

test("guard: private address checks cover IPv6 ranges and mapped IPv4", () => {
  for (const address of ["::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:7f00:1"]) {
    assert.ok(isPrivateAddress(address), `${address} should be private`);
  }
  for (const address of ["2606:4700::6810:84e5", "93.184.215.14", "::ffff:93.184.215.14"]) {
    assert.ok(!isPrivateAddress(address), `${address} should be public`);
  }
});

test("guard: a hostname resolving to a private address is rejected", async () => {
  resetNetwork();
  assert.ok(await checkHost("evil.example"));
  assert.ok(await checkHost("sneaky.example"), "any private address rejects the host");
  assert.ok(await checkHost("mapped.example"), "IPv4-mapped private address");
  assert.ok(await checkHost("v6local.example"), "fd00::/8");
  assert.equal(blockedHostReason("evil.example"), null, "hostname-only check can't see DNS");
});

test("guard: fetchPage refuses a private host before sending anything", async () => {
  resetNetwork({ "https://evil.example/": { body: "secret" } });
  const result = await fetchPage("https://evil.example/");
  assert.equal(result.errorKind, "private");
  assert.equal(requested.length, 0);
});

test("fetcher: a redirect hop to a private address is not followed", async () => {
  resetNetwork({
    "https://example.com/start": { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } },
    "http://169.254.169.254/latest/meta-data": { body: "credentials" },
  });
  const result = await fetchPage("https://example.com/start");
  assert.equal(result.errorKind, "private");
  assert.deepEqual(requested, ["https://example.com/start"]);
  assert.equal(result.redirectChain.length, 1);
});

test("fetcher: relative redirects resolve, chains are recorded, hops are capped", async () => {
  resetNetwork({
    "https://example.com/a": { status: 301, headers: { location: "/b" } },
    "https://example.com/b": { status: 302, headers: { location: "c" } },
    "https://example.com/c": { body: "<title>done</title>" },
  });
  const result = await fetchPage("https://example.com/a");
  assert.equal(result.status, 200);
  assert.equal(result.finalUrl, "https://example.com/c");
  assert.deepEqual(result.redirectChain.map((hop) => hop.status), [301, 302]);

  const loop: Record<string, Route> = {};
  for (let i = 0; i < 8; i++) loop[`https://example.com/loop${i}`] = { status: 302, headers: { location: `/loop${i + 1}` } };
  resetNetwork(loop);
  assert.equal((await fetchPage("https://example.com/loop0")).errorKind, "too-many-redirects");
});

test("fetcher: off-host redirects are recorded, not followed, when a host filter is set", async () => {
  resetNetwork({ "https://example.com/go/bookie": { status: 302, headers: { location: "https://bookie.example/?aff=1" } } });
  const result = await fetchPage("https://example.com/go/bookie", { allowHost: (host) => host.endsWith("example.com") });
  assert.equal(result.offHostRedirect, "https://bookie.example/?aff=1");
  assert.deepEqual(requested, ["https://example.com/go/bookie"]);
});

test("fetcher: bodies stop at the size cap, charsets decode, bot protection is detected", async () => {
  resetNetwork({
    "https://example.com/big": { body: "x".repeat(5000) },
    "https://example.com/latin": { body: "", headers: { "content-type": "text/html; charset=iso-8859-1" } },
    "https://example.com/cf": { status: 403, body: "<html><title>Just a moment...</title></html>", headers: { "cf-mitigated": "challenge" } },
  });
  const big = await fetchPage("https://example.com/big", { maxBytes: 1000 });
  assert.equal(big.truncated, true);
  assert.equal(big.body.length, 1000);
  const shared = fetcherConfig.fetch;
  fetcherConfig.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/latin")) {
      return new Response(new Uint8Array([0x63, 0x61, 0x66, 0xe9]), { headers: { "content-type": "text/html; charset=iso-8859-1" } });
    }
    return shared(input, init);
  }) as typeof fetch;
  try {
    assert.equal((await fetchPage("https://example.com/latin")).body, "café");
  } finally {
    fetcherConfig.fetch = shared;
  }
  const cf = await fetchPage("https://example.com/cf");
  assert.equal(cf.blocked, true);
});

test("map: robots.txt sitemaps, index, lastmod and private sitemap URLs", async () => {
  resetNetwork({
    "https://example.com/robots.txt": {
      body: "User-agent: *\nDisallow: /private\nSitemap: https://example.com/sitemap_index.xml\nSitemap: https://evil.example/s.xml",
      headers: { "content-type": "text/plain" },
    },
    "https://example.com/sitemap_index.xml": {
      body: "<sitemapindex><sitemap><loc>https://example.com/a.xml</loc></sitemap><sitemap><loc>http://10.0.0.5/b.xml</loc></sitemap></sitemapindex>",
      headers: { "content-type": "application/xml" },
    },
    "https://example.com/a.xml": {
      body: "<urlset><url><loc>https://example.com/predictions/a-vs-b</loc><lastmod>2026-10-01</lastmod></url><url><loc>https://example.com/predictions/c-vs-d</loc></url></urlset>",
      headers: { "content-type": "application/xml" },
    },
  });
  const result = await mapSite("https://example.com");
  assert.equal(result.source, "sitemap", `requested: ${requested.join(", ")}; notes: ${result.notes.join(" ")}`);
  assert.deepEqual(result.urls, ["https://example.com/predictions/a-vs-b", "https://example.com/predictions/c-vs-d"]);
  assert.equal(result.lastmod.get("https://example.com/predictions/a-vs-b"), "2026-10-01T00:00:00.000Z");
  assert.equal(result.sitemapStats.length, 2);
  assert.ok(!requested.some((url) => url.includes("evil.example") || url.includes("10.0.0.5")), "private sitemap URLs are never fetched");
});

test("crawl fallback: affiliate paths and off-site redirects are never requested", async () => {
  resetNetwork({
    "https://tips.example/": {
      body: '<html><body><main><a href="/predictions/a/">A</a><a href="/go/bookie/">Bet now</a><a href="/out/x">Out</a><a href="/moved/">Moved</a></main></body></html>',
    },
    "https://tips.example/predictions/a/": { body: "<html><body><p>Prediction</p></body></html>" },
    "https://tips.example/moved/": { status: 301, headers: { location: "https://bookie.example/landing" } },
    "https://tips.example/go/bookie/": { status: 302, headers: { location: "https://bookie.example/?aff=1" } },
  });
  const result = await mapSite("https://tips.example");
  assert.equal(result.source, "crawl");
  assert.deepEqual(result.urls, ["https://tips.example/", "https://tips.example/predictions/a/"]);
  assert.ok(!requested.some((url) => url.includes("/go/") || url.includes("/out/")), requested.join(", "));
  assert.ok(!requested.some((url) => url.includes("bookie.example")), "off-site redirect targets aren't fetched");
});

test("analysis: affiliate paths are recorded, not requested", async () => {
  resetNetwork(tipsSite());
  const { parseRobots } = await import("../lib/robots");
  const pages = await analyseUrls(["https://tips.example/go/bet9ja/"], {
    pattern: "/go/*",
    patterns: PATTERNS,
    robots: parseRobots("", "https://tips.example"),
    siteHost: "tips.example",
    budget: new Budget(),
  });
  assert.equal(pages[0].outcome, "affiliate");
  assert.equal(requested.length, 0);
});

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

test("robots: wildcards, $ anchors and longest rule wins", () => {
  const robots = parseRobots(
    [
      "User-agent: Googlebot",
      "Disallow: /",
      "",
      "User-agent: *",
      "Disallow: /private",
      "Allow: /private/ok",
      "Disallow: /*.php$",
      "Disallow: /search*q=",
      "Crawl-delay: 5",
      "Sitemap: /sitemap.xml",
    ].join("\n"),
    "https://example.com",
  );
  assert.equal(robots.isAllowed("https://example.com/private/x"), false);
  assert.equal(robots.isAllowed("https://example.com/private/ok/1"), true, "longer allow wins");
  assert.equal(robots.isAllowed("https://example.com/page.php"), false, "$ anchor matches the end");
  assert.equal(robots.isAllowed("https://example.com/page.php?x=1"), true, "$ anchor doesn't match with a query");
  assert.equal(robots.isAllowed("https://example.com/search?a=1&q=x"), false, "* wildcard");
  assert.equal(robots.isAllowed("https://example.com/"), true);
  assert.equal(robots.isAllowed("https://example.com/", "googlebot"), false, "agent-specific group");
  assert.deepEqual(robots.sitemaps, ["https://example.com/sitemap.xml"]);
  assert.equal(robots.groups[1].crawlDelay, 5);
});

test("robots: AI crawler access", () => {
  const robots = parseRobots("User-agent: GPTBot\nDisallow: /\n\nUser-agent: CCBot\nDisallow: /data\n\nUser-agent: *\nAllow: /", "https://example.com");
  const access = Object.fromEntries(aiBotAccess(robots).map((entry) => [entry.bot, entry.access]));
  assert.equal(access.GPTBot, "blocked");
  assert.equal(access.CCBot, "partly blocked");
  assert.equal(access.ClaudeBot, "allowed");
});

// ---------------------------------------------------------------------------
// Page analysis
// ---------------------------------------------------------------------------

const PATTERNS = ["/", "/predictions/*", "/league/*/table", "/about", "/predictions"];

test("schema: @graph parses, invalid JSON is reported, FAQ mismatches are flagged", () => {
  const data = analyseHtml(wordpressPrediction("Arsenal", "Chelsea", 12), { url: "https://tips.example/predictions/arsenal-vs-chelsea/", patterns: PATTERNS });
  assert.deepEqual(data.schema.types, ["WebSite", "SportsEvent", "BreadcrumbList", "FAQPage"]);
  assert.equal(data.schema.blocks.length, 2);
  assert.equal(data.schema.blocks[0].valid, true);
  assert.equal(data.schema.blocks[1].valid, false);
  assert.match(data.schema.blocks[1].error ?? "", /JSON|property/i);
  const event = data.schema.entities.find((entity) => entity.type === "SportsEvent")!;
  assert.equal(event.details.homeTeam, "Arsenal");
  assert.deepEqual(data.schema.faq.notVisible, ["Is there a hidden question?"]);
  assert.deepEqual(data.structure.breadcrumb, ["Home", "Predictions", "Arsenal vs Chelsea"]);
});

test("page analysis: head, structure, links, signals and sports niche", () => {
  const data = analyseHtml(wordpressPrediction("Arsenal", "Chelsea", 12), {
    url: "https://tips.example/predictions/arsenal-vs-chelsea/",
    headers: { server: "cloudflare", "x-powered-by": "PHP/8.2" },
    patterns: PATTERNS,
  });
  assert.equal(data.head.canonical.kind, "self");
  assert.equal(data.structure.h1Count, 1);
  assert.equal(data.structure.main.source, "main");
  assert.ok(data.structure.blocks.some((block) => block.signature === "main#content.site-main"));
  assert.equal(data.structure.images.missingAlt, 1);
  assert.deepEqual(data.links.affiliate.redirectPaths.map((r) => r.url), ["https://tips.example/go/bet9ja/", "https://tips.example/go/sportybet/"]);
  assert.ok(data.links.unmatchedInternal.includes("https://tips.example/secret-page/"));
  assert.equal(data.links.internalByPattern.find((t) => t.pattern === "/league/*/table")?.count, 2);
  assert.ok(data.links.messaging.some((m) => m.kind === "Telegram"));
  assert.equal(data.signals.trust.responsibleGambling, true);
  assert.deepEqual(data.signals.trust.helpOrganisations, ["BeGambleAware"]);
  assert.equal(data.niche.niche, "sports predictions/betting");
  assert.deepEqual(data.niche.sports?.fixtures, ["Arsenal vs Chelsea"]);
  assert.deepEqual(data.niche.sports?.bookmakers, ["Bet9ja", "bet365"]);
  assert.deepEqual(data.niche.sports?.bookingCodes, ["B9X7K2Q"]);
  assert.ok(data.perf.mixedContent.length === 1);
  assert.ok(data.perf.validators.pageSpeed.startsWith("https://pagespeed.web.dev/analysis?url=https%3A%2F%2F"));
});

test("stack: WordPress and Next.js are detected, client rendering is spotted", () => {
  const wp = analyseHtml(wordpressPrediction("Lyon", "PSG", 13), { url: "https://tips.example/predictions/lyon-vs-psg/", headers: { server: "cloudflare" } });
  assert.deepEqual(wp.tech.cms.map((c) => c.name), ["WordPress", "Yoast SEO"]);
  assert.deepEqual(wp.tech.hosting.map((h) => h.name), ["Cloudflare"]);
  assert.ok(wp.tech.thirdParties.some((t) => t.category === "sports data"));
  assert.deepEqual(wp.tech.tagIds.ga4, ["G-ABC1234567"]);
  const next = analyseHtml(nextAppRouterPage(), { url: "https://acme.example/pricing", headers: { "x-vercel-id": "1" } });
  assert.deepEqual(next.tech.frameworks.map((f) => f.name), ["Next.js (app router)"]);
  assert.deepEqual(next.tech.hosting.map((h) => h.name), ["Vercel"]);
  assert.equal(next.tech.rendering, "server-rendered");
  const spa = analyseHtml(clientRenderedShell(), { url: "https://spa.example/" });
  assert.equal(spa.tech.rendering, "mostly client-rendered");
});

function tipsSite(): Record<string, Route> {
  const html = (body: string) => ({ body, headers: { "content-type": "text/html; charset=utf-8" } });
  return {
    "https://tips.example/robots.txt": {
      body: "User-agent: *\nDisallow: /private/\nCrawl-delay: 2\n\nUser-agent: GPTBot\nDisallow: /\n\nSitemap: https://tips.example/sitemap.xml",
      headers: { "content-type": "text/plain" },
    },
    "https://tips.example/": { ...html(wordpressPrediction("Home", "Page", 1)), headers: { "content-type": "text/html", server: "cloudflare", "cf-cache-status": "HIT", "strict-transport-security": "max-age=1" } },
    "https://tips.example/ads.txt": { body: "google.com, pub-1, DIRECT, f08c47fec0942fa0\nappnexus.com, 2, RESELLER\n# c\nOWNERDOMAIN=tips.example", headers: { "content-type": "text/plain" } },
    "https://tips.example/app-ads.txt": html("<!doctype html><title>Not found</title>"),
    "https://tips.example/llms.txt": { body: "# Tips\n> Football predictions", headers: { "content-type": "text/plain" } },
    "http://tips.example/": { status: 301, headers: { location: "https://tips.example/" } },
    "https://www.tips.example/": { status: 301, headers: { location: "https://tips.example/" } },
    "https://tips.example/predictions/arsenal-vs-chelsea/": html(wordpressPrediction("Arsenal", "Chelsea", 12)),
    "https://tips.example/predictions/arsenal-vs-chelsea": { status: 301, headers: { location: "/predictions/arsenal-vs-chelsea/" } },
    "https://tips.example/predictions/lyon-vs-psg/": html(wordpressPrediction("Lyon", "PSG", 13)),
    "https://tips.example/predictions/blocked/": { status: 403, body: cloudflareChallenge, headers: { "content-type": "text/html", "cf-mitigated": "challenge" } },
    "https://tips.example/predictions/moved/": { status: 302, headers: { location: "https://bookie.example/landing" } },
  };
}

test("site checks: robots, root files and host behaviour, never leaving the site", async () => {
  resetNetwork(tipsSite());
  const report = await checkSite({ origin: "https://tips.example", patterns: PATTERNS, sampleUrl: "https://tips.example/predictions/arsenal-vs-chelsea/" });
  assert.equal(report.robots.present, true);
  assert.equal(report.robots.aiBots.find((b) => b.bot === "GPTBot")?.access, "blocked");
  assert.equal(report.robots.groups[0].crawlDelay, 2);
  assert.equal(report.files.adsTxt.present, true);
  assert.equal(report.files.adsTxt.direct, 1);
  assert.equal(report.files.adsTxt.reseller, 1);
  assert.equal(report.files.adsTxt.ownerDomain, "tips.example");
  assert.equal(report.files.appAdsTxt.present, false, "HTML soft 404 counts as missing");
  assert.equal(report.files.llmsTxt.firstLines[0], "# Tips");
  assert.equal(report.host.https.redirectsToHttps, true);
  assert.equal(report.host.canonicalHost.winner, "bare domain");
  assert.match(report.host.trailingSlash?.note ?? "", /without a slash redirects to the trailing-slash form/);
  assert.equal(report.host.notFound.kind, "real 404");
  assert.equal(report.homepage.outcome, "ok");
  assert.equal(report.headers.cfCacheStatus, "HIT");
  assert.equal(report.headers.strictTransportSecurity, true);
  assert.equal(requested[0], "https://tips.example/robots.txt", "robots.txt is read first");
  const hosts = new Set(requested.map((url) => new URL(url).hostname));
  assert.deepEqual([...hosts].sort(), ["tips.example", "www.tips.example"]);
});

test("analysis: blocked pages, robots skips and off-site redirects; only the mapped host is requested", async () => {
  resetNetwork(tipsSite());
  const { parseRobots } = await import("../lib/robots");
  const robots = parseRobots("User-agent: *\nDisallow: /private/", "https://tips.example");
  const pages = await analyseUrls(
    [
      "https://tips.example/predictions/arsenal-vs-chelsea/",
      "https://tips.example/predictions/blocked/",
      "https://tips.example/private/x",
      "https://tips.example/predictions/moved/",
    ],
    { pattern: "/predictions/*", patterns: PATTERNS, robots, siteHost: "tips.example", budget: new Budget() },
  );
  assert.deepEqual(pages.map((page) => page.outcome), ["ok", "blocked", "robots", "off-host"]);
  assert.equal(pages[1].message, "Blocked by bot protection. Open view-source:https://tips.example/predictions/blocked/ in a browser to study it manually.");
  assert.equal(pages[3].offHostRedirect, "https://bookie.example/landing");
  assert.ok(requested.every((url) => new URL(url).hostname === "tips.example"), requested.join(", "));
  assert.ok(!requested.some((url) => url.includes("/go/")), "affiliate redirects are never requested");
  assert.ok(!requested.some((url) => url.includes("/private/")), "robots-disallowed URLs are never requested");
});

test("routes: URLs off the mapped host get a 400; foreign Origin headers get a 403", async () => {
  resetNetwork(tipsSite());
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    new Request("http://localhost:3000/api/analyse", {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost:3000", ...headers },
      body: JSON.stringify(body),
    });
  const offHost = await analyseRoute(post({ origin: "https://tips.example", pattern: "/x/*", urls: ["https://bookie.example/x/1"] }));
  assert.equal(offHost.status, 400);
  const tooMany = await analyseRoute(post({ origin: "https://tips.example", pattern: "/x/*", urls: ["https://tips.example/1", "https://tips.example/2", "https://tips.example/3", "https://tips.example/4"] }));
  assert.equal(tooMany.status, 400);
  const privateOrigin = await analyseRoute(post({ origin: "https://evil.example", pattern: "/", urls: ["https://evil.example/"] }));
  assert.equal(privateOrigin.status, 400);
  const foreign = await analyseRoute(post({ origin: "https://tips.example", pattern: "/", urls: ["https://tips.example/"] }, { origin: "https://attacker.example" }));
  assert.equal(foreign.status, 403);
  const site = await siteRoute(
    new Request("http://localhost:3000/api/site", {
      method: "POST",
      headers: { "content-type": "application/json", host: "localhost:3000" },
      body: JSON.stringify({ origin: "https://tips.example", sampleUrl: "https://bookie.example/" }),
    }),
  );
  assert.equal(site.status, 400);
  const ok = await analyseRoute(post({ origin: "https://tips.example", pattern: "/predictions/*", urls: ["https://tips.example/predictions/lyon-vs-psg/"], patterns: PATTERNS }, { origin: "http://localhost:3000" }));
  assert.equal(ok.status, 200);
  const json = (await ok.json()) as { pages: { outcome: string }[] };
  assert.equal(json.pages[0].outcome, "ok");
});

// ---------------------------------------------------------------------------
// Aggregation, issues and report
// ---------------------------------------------------------------------------

test("templates: dates become {date}, differing runs become {x} or {n}", () => {
  assert.equal(
    buildTemplate([
      "Arsenal vs Chelsea Prediction, Tips & Odds – 12 Oct 2026",
      "Lyon vs PSG Prediction, Tips & Odds – 13 Oct 2026",
    ]).template,
    "{x} vs {x} Prediction, Tips & Odds – {date}",
  );
  assert.equal(buildTemplate(["Page 2 of 9 | Blog", "Page 3 of 9 | Blog"]).template, "Page {n} of 9 | Blog");
  const single = buildTemplate(["Results for October 12, 2026 and 2026-10-13"]);
  assert.equal(single.template, "Results for {date} and {date}");
  assert.equal(single.needsMoreSamples, true);
});

test("content engine: skeletons, boilerplate and uniqueness on two fixture pages", () => {
  const url = (slug: string) => `https://tips.example/predictions/${slug}/`;
  const a = analyseHtml(wordpressPrediction("Arsenal", "Chelsea", 12), { url: url("arsenal-vs-chelsea") });
  const b = analyseHtml(wordpressPrediction("Lyon", "PSG", 13), { url: url("lyon-vs-psg") });
  assert.equal(sentenceSkeleton("Arsenal host Chelsea on 12 Oct 2026 with kick-off at 19:00 WAT."), "{name} host {name} on {date} with kick-off at {n} {name}.");
  assert.equal(sentenceSkeleton("The match starts at 19:00."), "The match starts at {n}.", "common openers stay literal");
  const engine = contentEngine([a.structure.sentences, b.structure.sentences]);
  assert.ok(engine.templated.some((t) => t.skeleton.startsWith("{name} host {name} on {date}")), JSON.stringify(engine.templated));
  assert.ok(engine.boilerplate.includes("This preview is written by the editorial team and checked before every match day so the tips stay accurate and fair."));
  assert.ok(engine.uniqueness !== null && engine.uniqueness > 0.1 && engine.uniqueness < 0.9, String(engine.uniqueness));
  assert.equal(contentEngine([a.structure.sentences]).uniqueness, null, "one sample has no uniqueness");
  const identical = contentEngine([a.structure.sentences, a.structure.sentences]);
  assert.equal(identical.uniqueness, 0);
});

test("sampling takes the start, middle and end of a group, on the mapped host only", () => {
  const urls = Array.from({ length: 9 }, (_, i) => `https://tips.example/p/${i}`);
  assert.deepEqual(pickSamples(urls, 3, "tips.example"), ["https://tips.example/p/0", "https://tips.example/p/4", "https://tips.example/p/8"]);
  assert.deepEqual(pickSamples(urls, 2, "www.tips.example"), ["https://tips.example/p/0", "https://tips.example/p/8"]);
  assert.deepEqual(pickSamples(["https://cdn.other.example/x", "https://tips.example/a"], 3, "tips.example"), ["https://tips.example/a"]);
  const tree = architectureTree([{ pattern: "/league/*/table", count: 8 }, { pattern: "/league/*/results", count: 8 }, { pattern: "/", count: 1 }]);
  assert.equal(tree.children[0].segment, "league");
  assert.equal(tree.children[0].count, 16);
});

function page(url: string, pattern: string, html: string | null, extra: Partial<PageAnalysis> = {}): PageAnalysis {
  return {
    url,
    pattern,
    finalUrl: url,
    status: html ? 200 : 500,
    outcome: html ? "ok" : "error",
    message: html ? null : "The page returned status 500.",
    redirectChain: [],
    offHostRedirect: null,
    ms: 120,
    bytes: html?.length ?? 0,
    truncated: false,
    headers: {},
    data: html ? analyseHtml(html, { url, patterns: ["/", "/predictions/*", "/thin/*", "/misc/*", "/orphan/*"] }) : null,
    ...extra,
  };
}

function result(pattern: string, pages: PageAnalysis[], count = 10): PatternResult {
  return { pattern, count, pages, aggregate: aggregatePattern(pattern, pages), trimmed: [] };
}

async function fixtureState(): Promise<AnalysisState> {
  resetNetwork(tipsSite());
  const site = await checkSite({ origin: "https://tips.example", patterns: PATTERNS, sampleUrl: "https://tips.example/predictions/arsenal-vs-chelsea/" });
  site.host.notFound = { ...site.host.notFound, kind: "soft 404", status: 200, note: "A made-up URL returns 200 (soft 404)." };
  site.host.canonicalHost = { ...site.host.canonicalHost, winner: "both serve pages" };
  const thinHtml = (n: number) =>
    `<html><head><title>Thin ${n}</title><meta name="description" content="d"><link rel="canonical" href="https://tips.example/thin/${n}"></head><body><main><h1>Thin</h1><p>This short page repeats the same words as every other page in this pattern.</p></main></body></html>`;
  const misc = (title: string, head: string, body: string) => `<html><head><title>${title}</title>${head}</head><body><main>${body}</main></body></html>`;
  const longText = "x".repeat(70);
  return {
    map: {
      origin: "https://tips.example",
      host: "tips.example",
      source: "sitemap",
      total: 100,
      sitemaps: ["https://tips.example/sitemap.xml"],
      sitemapStats: [{ url: "https://tips.example/sitemap.xml", kind: "urlset", urls: 100, withLastmod: 100, oldestLastmod: null, newestLastmod: null, distinctLastmod: 1, extensions: { image: false, video: false, news: false, hreflang: false }, autoLastmod: true }],
      truncated: false,
      notes: [],
      groups: ["/predictions/*", "/thin/*", "/misc/*", "/orphan/*", "/"].map((pattern) => ({ pattern, count: 10, share: 10, lastmodNewest: null, lastmodOldest: null, lastmodCoverage: 0, placeholders: [] })),
    },
    site,
    pagesPerPattern: 2,
    generatedAt: "2026-10-06T12:00:00.000Z",
    patterns: [
      result("/predictions/*", [
        page("https://tips.example/predictions/arsenal-vs-chelsea/", "/predictions/*", wordpressPrediction("Arsenal", "Chelsea", 12), {
          redirectChain: [
            { url: "a", status: 301, location: "b" },
            { url: "b", status: 301, location: "c" },
          ],
        }),
        page("https://tips.example/predictions/lyon-vs-psg/", "/predictions/*", wordpressPrediction("Lyon", "PSG", 13)),
        page("https://tips.example/predictions/broken/", "/predictions/*", null),
        { ...page("https://tips.example/predictions/cf/", "/predictions/*", null), outcome: "blocked", status: 403, message: "Blocked by bot protection. Open view-source:https://tips.example/predictions/cf/ in a browser to study it manually." },
      ]),
      result("/thin/*", [page("https://tips.example/thin/1", "/thin/*", thinHtml(1)), page("https://tips.example/thin/2", "/thin/*", thinHtml(1))]),
      result("/misc/*", [
        page("https://tips.example/misc/1", "/misc/*", misc("", "", "<p>No title, no description, no H1, no canonical.</p>")),
        page("https://tips.example/misc/2", "/misc/*", misc(`A title that is far too long for search results ${longText}`, `<meta name="description" content="${"d".repeat(170)}"><meta name="robots" content="noindex"><link rel="canonical" href="https://tips.example/other">`, "<h1>One</h1><h1>Two</h1>")),
        page("https://tips.example/misc/3", "/misc/*", clientRenderedShell()),
      ]),
    ],
  };
}

test("issues: every rule fires on fixture data built to trigger it; blocked pages are separate", async () => {
  const state = await fixtureState();
  const { issues, blocked } = findIssues(state);
  const ids = new Set(issues.map((item) => item.id));
  const expected = [
    "http-errors", "missing-title", "duplicate-titles", "long-titles", "missing-description", "long-descriptions",
    "missing-h1", "multiple-h1", "canonical-missing", "canonical-elsewhere", "noindex-in-sitemap", "invalid-jsonld",
    "faq-not-visible", "client-rendered", "thin-pages", "images-missing-alt", "images-missing-dimensions",
    "mixed-content", "redirect-chains", "soft-404", "host-handling", "lastmod-auto", "links-not-in-sitemap",
    "internal-nofollow", "unlinked-patterns",
  ];
  for (const id of expected) assert.ok(ids.has(id), `rule ${id} should fire`);
  assert.deepEqual(blocked.map((item) => item.url), ["https://tips.example/predictions/cf/"]);
  assert.ok(!issues.some((item) => item.examples.includes("https://tips.example/predictions/cf/")), "blocked pages aren't site issues");
  const order = issues.map((item) => item.severity);
  assert.deepEqual(order, [...order].sort((a, b) => ["high", "medium", "low"].indexOf(a) - ["high", "medium", "low"].indexOf(b)));
  assert.ok(issues.find((item) => item.id === "unlinked-patterns")?.patterns.includes("/orphan/*"));
  for (const item of issues) assert.ok(item.examples.length <= 3);
});

test("report: sections in order, every sampled URL as a full link", async () => {
  const state = await fixtureState();
  const report = buildReport(state);
  if (process.env.PRINT_REPORT) console.log(report);
  const headings = report.split("\n").filter((line) => line.startsWith("## "));
  assert.deepEqual(headings, [
    "## Summary", "## Site files", "## Host behaviour", "## Stack and third parties", "## Patterns",
    "## Pattern details", "## Link map", "## Linked but not in the sitemap", "## Issues", "## Method and limits",
  ]);
  for (const result of state.patterns) {
    for (const sampled of result.pages) assert.ok(report.includes(`[${sampled.url}](${sampled.url})`), `${sampled.url} should be linked`);
  }
  assert.ok(report.includes("| pattern | pages | share | sampled | title template | schema types | avg words | uniqueness | issues |"));
  assert.ok(report.includes("{x} vs {x} Prediction, Tips & Odds – {date}"));
});

// ---------------------------------------------------------------------------

async function main() {
  let failed = 0;
  for (const { name, run } of tests) {
    try {
      await run();
      console.log(`ok    ${name}`);
    } catch (error) {
      failed++;
      console.log(`FAIL  ${name}`);
      console.log(error instanceof Error ? error.stack ?? error.message : error);
    }
  }
  console.log(`\n${tests.length - failed} of ${tests.length} tests passed.`);
  if (failed > 0) process.exit(1);
}

main();
