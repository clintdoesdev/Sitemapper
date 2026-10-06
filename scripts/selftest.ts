// Run with: npx tsx scripts/selftest.ts   (or: npm run selftest)
// Offline: DNS lookups and fetch are injected, so no request leaves the machine.
import assert from "node:assert/strict";
import { checkHost, clearGuardCache, guardConfig, isPrivateAddress, blockedHostReason } from "../lib/guard";
import { fetchPage, fetcherConfig } from "../lib/fetcher";
import { parseRobots, aiBotAccess } from "../lib/robots";
import { groupByPattern, groupUrls, matchPattern, classifySegment, spreadSample, textTemplate } from "../lib/patterns";
import { mapSite, parseSitemap, sitemapStat } from "../lib/crawl";
import { extractPages, type ExtractResult } from "../lib/contents";
import { POST as extractRoute } from "../app/api/extract/route";
import { POST as jobsRoute } from "../app/api/jobs/route";
import { createJob, getJobItems, getJobResults, getJobStatus, jobsConfig, runSlice, stopJob, type JobMeta } from "../lib/jobs";
import { memoryStore, storeConfig } from "../lib/store";
import { POST as runRoute } from "../app/api/jobs/[id]/run/route";

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

test("sampling: up to N pages per group, spread from first to last", () => {
  const items = Array.from({ length: 100 }, (_, i) => i);
  assert.deepEqual(spreadSample(items, 3), [0, 50, 99]);
  const ten = spreadSample(items, 10);
  assert.equal(ten.length, 10);
  assert.equal(ten[0], 0);
  assert.equal(ten[9], 99);
  assert.deepEqual(spreadSample([1, 2], 10), [1, 2]);
  assert.equal(spreadSample(items, null).length, 100);
  assert.deepEqual(spreadSample(items, 1), [0]);
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

test("read every page: a page refused to SitemapperBot is read as a regular browser; affiliate paths are never requested", async () => {
  resetNetwork();
  const shared = fetcherConfig.fetch;
  const agents: string[] = [];
  fetcherConfig.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requested.push(url);
    const agent = new Headers(init?.headers).get("user-agent") ?? "";
    if (url.endsWith("/robots.txt")) return new Response("", { status: 404 });
    agents.push(agent);
    if (agent.includes("SitemapperBot")) return new Response("no bots", { status: 403, headers: { "content-type": "text/html" } });
    return new Response("<html><head><title>Hello</title></head><body><main><p>Real words.</p></main></body></html>", {
      headers: { "content-type": "text/html" },
    });
  }) as typeof fetch;
  try {
    const [page, affiliate] = await extractPages(["https://example.com/a", "https://example.com/go/bookie"]);
    assert.equal(page.ok, true);
    assert.equal(page.ok && page.title, "Hello");
    assert.ok(agents[0].includes("SitemapperBot"), "the first ask is as SitemapperBot");
    assert.equal(agents.length, 2);
    assert.equal(affiliate.ok, false);
    assert.ok(!requested.some((url) => url.includes("/go/")));
  } finally {
    fetcherConfig.fetch = shared;
  }
});

test("routes: foreign Origin headers get a 403; off-site pages can't be queued", async () => {
  storeConfig.store = memoryStore();
  try {
    const post = (route: (request: Request) => Promise<Response>, path: string, body: unknown, origin?: string) =>
      route(
        new Request(`http://localhost:3000${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", host: "localhost:3000", ...(origin ? { origin } : {}) },
          body: JSON.stringify(body),
        }),
      );
    assert.equal((await post(extractRoute, "/api/extract", { urls: ["https://example.com/"] }, "https://attacker.example")).status, 403);
    assert.equal((await post(jobsRoute, "/api/jobs", { origin: "https://example.com", items: [] }, "https://attacker.example")).status, 403);
    const offSite = await post(jobsRoute, "/api/jobs", { origin: "https://example.com", items: [["https://bookie.example/x", "/x"]] });
    assert.equal(offSite.status, 400);
    const privateOrigin = await post(jobsRoute, "/api/jobs", { origin: "https://evil.example", items: [["https://evil.example/", "/"]] });
    assert.equal(privateOrigin.status, 400);
  } finally {
    storeConfig.store = undefined;
  }
});
test("read every page: a slow page doesn't hold up the others; robots.txt is read once per run", async () => {
  resetNetwork();
  const html = "<html><head><title>T</title></head><body><main><p>Some words here.</p></main></body></html>";
  const shared = fetcherConfig.fetch;
  const fetched: string[] = [];
  fetcherConfig.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    fetched.push(url);
    if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /private", { headers: { "content-type": "text/plain" } });
    await new Promise((r) => setTimeout(r, url.endsWith("/slow") ? 1500 : 150));
    return new Response(html, { headers: { "content-type": "text/html" } });
  }) as typeof fetch;
  try {
    const urls = ["https://example.com/slow", ...Array.from({ length: 19 }, (_, i) => `https://example.com/p${i}`)];
    const robotsOut: Record<string, string> = {};
    const started = Date.now();
    const pages = await extractPages(urls, { robotsOut });
    const elapsed = Date.now() - started;
    assert.equal(pages.filter((page) => page.ok).length, 20);
    // 19 fast pages across 5 free workers take ~600ms, running alongside the slow one.
    assert.ok(elapsed < 2200, `took ${elapsed}ms`);
    assert.equal(robotsOut["https://example.com"], "User-agent: *\nDisallow: /private");

    fetched.length = 0;
    const again = await extractPages(["https://example.com/p1", "https://example.com/private/x"], { robotsTxt: robotsOut });
    assert.ok(!fetched.some((url) => url.endsWith("/robots.txt")), "known robots.txt isn't fetched again");
    assert.equal(again[1].ok, false, "rules from the passed robots.txt still apply");
  } finally {
    fetcherConfig.fetch = shared;
  }
});

test("background jobs: read, retry after a 429, hand over between slices, page through results", async () => {
  resetNetwork();
  storeConfig.store = memoryStore();
  const shared = fetcherConfig.fetch;
  const savedConfig = { ...jobsConfig };
  const kicks: string[] = [];
  jobsConfig.retryDelaysMs = [10, 10, 10];
  jobsConfig.sliceMs = 13_500;
  jobsConfig.kick = async (meta: JobMeta) => {
    kicks.push(meta.id);
    await runSlice(meta.id);
  };
  let limitedOnce = false;
  fetcherConfig.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url);
    if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /private", { headers: { "content-type": "text/plain" } });
    if (url.endsWith("/busy") && !limitedOnce) {
      limitedOnce = true;
      return new Response("slow down", { status: 429, headers: { "retry-after": "2", "content-type": "text/html" } });
    }
    return new Response(`<html><head><title>${url}</title></head><body><main><p>Words for ${url}.</p></main></body></html>`, {
      headers: { "content-type": "text/html" },
    });
  }) as typeof fetch;
  try {
    const urls = [
      ...Array.from({ length: 70 }, (_, i) => `https://example.com/p/${i}`),
      "https://example.com/busy",
      "https://example.com/private/x",
      "https://example.com/go/bookie",
    ];
    await assert.rejects(
      createJob({ origin: "https://example.com", items: [["https://bookie.example/x", "/x"]], identity: "bot", selfOrigin: "http://localhost" }),
      /Only URLs on example.com/,
    );
    const meta = await createJob({
      origin: "https://example.com",
      items: [...urls.map((url) => [url, url.startsWith("https://example.com/p/") ? "/p/*" : "/"]), [urls[0], "/p/*"]],
      identity: "bot",
      selfOrigin: "http://localhost",
    });
    assert.equal(meta.total, urls.length, "duplicate pages are dropped");
    await runSlice(meta.id);

    const found = await getJobStatus(meta.id);
    assert.ok(found);
    assert.equal(found.status.status, "done");
    assert.equal(found.status.done, urls.length);
    assert.equal(found.status.failed, 2, "robots.txt and the affiliate path stay failed");
    assert.ok(kicks.length >= 1, "the slice handed over while the site asked to wait");
    assert.equal(requested.filter((url) => url.endsWith("/robots.txt")).length, 1, "robots.txt is read once per job");
    assert.ok(!requested.some((url) => url.includes("/go/") || url.includes("/private/")));
    assert.ok(!("key" in found.status));

    const all = new Map<string, ExtractResult>();
    let offset = 0;
    for (;;) {
      const page = await getJobResults(meta.id, offset);
      assert.ok(page);
      if (page.next === offset) break;
      for (const result of page.pages) all.set(result.url, result);
      offset = page.next;
    }
    assert.equal(all.size, urls.length);
    assert.equal(all.get("https://example.com/busy")?.ok, true, "the rate-limited page was read on retry");
    assert.equal((await getJobItems(meta.id))?.items[0][1], "/p/*");

    const forbidden = await runRoute(new Request(`http://localhost/api/jobs/${meta.id}/run`, { method: "POST" }), {
      params: Promise.resolve({ id: meta.id }),
    });
    assert.equal(forbidden.status, 403);

    const stopped = await createJob({ origin: "https://example.com", items: [[urls[0], "/p/*"]], identity: "bot", selfOrigin: "http://localhost" });
    assert.ok(await stopJob(stopped.id));
    requested.length = 0;
    await runSlice(stopped.id);
    assert.equal((await getJobStatus(stopped.id))?.status.status, "stopped");
    assert.equal(requested.length, 0, "a stopped job reads nothing");
  } finally {
    fetcherConfig.fetch = shared;
    Object.assign(jobsConfig, savedConfig);
    storeConfig.store = undefined;
  }
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
