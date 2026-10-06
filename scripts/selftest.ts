// Run with: npx tsx scripts/selftest.ts   (or: npm run selftest)
// Offline: DNS lookups and fetch are injected, so no request leaves the machine.
import assert from "node:assert/strict";
import { checkHost, clearGuardCache, guardConfig, isPrivateAddress, blockedHostReason } from "../lib/guard";
import { fetchPage, fetcherConfig } from "../lib/fetcher";
import { parseRobots, aiBotAccess } from "../lib/robots";
import { groupByPattern, textTemplate } from "../lib/patterns";

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
  routes["https://example.com/latin"] = { body: "", headers: { "content-type": "text/html; charset=iso-8859-1" } };
  fetcherConfig.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/latin")) {
      return new Response(new Uint8Array([0x63, 0x61, 0x66, 0xe9]), { headers: { "content-type": "text/html; charset=iso-8859-1" } });
    }
    const route = routes[url];
    return new Response(route?.body ?? "", { status: route?.status ?? 404, headers: { "content-type": "text/html", ...(route?.headers ?? {}) } });
  }) as typeof fetch;
  assert.equal((await fetchPage("https://example.com/latin")).body, "café");
  const cf = await fetchPage("https://example.com/cf");
  assert.equal(cf.blocked, true);
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
