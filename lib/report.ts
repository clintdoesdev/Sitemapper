/**
 * Markdown report. Facts only, always in the same order, so reports from
 * different sites compare cleanly. Browser-safe.
 */

import { buildLinkMap, stackSummary } from "./aggregate";
import type { AnalysisState, PatternResult } from "./analysis-types";
import type { PageAnalysis, PageData } from "./extract/types";
import { findIssues, issuesForPattern, type Issue } from "./issues";

const n = (value: number) => value.toLocaleString("en-US");
const pct = (value: number) => `${Math.round(value * 100)}%`;
const cell = (value: string) => value.replace(/\|/g, "\\|").replace(/\n/g, " ");
const code = (value: string) => `\`${value.replace(/`/g, "'")}\``;
const link = (url: string) => `[${url}](${url.replace(/\)/g, "%29").replace(/ /g, "%20")})`;
const yes = (value: boolean) => (value ? "yes" : "no");
const list = (values: readonly string[], empty = "none") => (values.length ? values.join(", ") : empty);
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "n/a");

function analysedData(pages: readonly PageAnalysis[]): PageData[] {
  return pages.map((page) => page.data).filter((data): data is PageData => data !== null);
}

function monetisation(pages: PageData[]): string[] {
  const total = pages.length;
  const count = (test: (page: PageData) => boolean) => pages.filter(test).length;
  const out = [
    `ads on ${count((p) => p.signals.ads.count > 0)} of ${total} pages`,
    `affiliate redirects on ${count((p) => p.links.affiliate.redirectPaths.length > 0)}`,
    `tracking parameters on ${count((p) => Object.keys(p.links.affiliate.trackingParams).length > 0)}`,
    `pricing or VIP links on ${count((p) => p.signals.conversion.pricing > 0)}`,
    `login links on ${count((p) => p.signals.conversion.login > 0)}`,
    `push opt-in on ${count((p) => p.signals.conversion.pushOptIn.length > 0)}`,
  ];
  return out;
}

function trust(pages: PageData[]): string[] {
  const count = (test: (page: PageData) => boolean) => pages.filter(test).length;
  const of = ` of ${pages.length}`;
  return [
    `18+ notice on ${count((p) => p.signals.trust.ageNotice)}${of}`,
    `responsible gambling text on ${count((p) => p.signals.trust.responsibleGambling)}${of}`,
    `licence or regulator mentions on ${count((p) => p.signals.trust.licence.length > 0)}${of}`,
    `privacy links on ${count((p) => p.signals.trust.privacy)}${of}`,
    `terms links on ${count((p) => p.signals.trust.terms)}${of}`,
    `author bylines on ${count((p) => p.signals.trust.author)}${of}`,
  ];
}

function templateLine(label: string, template: { template: string | null; needsMoreSamples: boolean }): string {
  if (!template.template) return `- ${label}: none shared`;
  return `- ${label}: ${code(template.template)}${template.needsMoreSamples ? " (needs 2+ samples)" : ""}`;
}

function patternSection(result: PatternResult, state: AnalysisState, issues: Issue[]): string[] {
  const group = state.map.groups.find((item) => item.pattern === result.pattern);
  const aggregate = result.aggregate;
  const data = analysedData(result.pages);
  const lines: string[] = [`### ${code(result.pattern)}`, ""];
  lines.push(`- Pages: ${n(result.count)}${group ? ` (${group.share}% of the site)` : ""}`);
  if (group) {
    lines.push(
      `- Freshness: newest lastmod ${day(group.lastmodNewest)}, oldest ${day(group.lastmodOldest)}, ${group.lastmodCoverage}% of URLs have one`,
    );
    for (const placeholder of group.placeholders) {
      lines.push(`- Segment ${placeholder.position + 1} placeholder: ${placeholder.kind} (e.g. ${placeholder.examples.map(code).join(", ")})`);
    }
  }
  lines.push(`- Sampled: ${aggregate.sampled}, analysed: ${aggregate.analysed}, blocked: ${aggregate.blocked}, failed: ${aggregate.failed}`);
  lines.push("", "Sampled URLs:", "");
  for (const page of result.pages) {
    lines.push(`- ${link(page.url)}: ${page.outcome === "ok" ? `status ${page.status}` : page.message ?? page.outcome}`);
  }
  lines.push("", "Template:", "");
  lines.push(templateLine("Title", aggregate.templates.title));
  lines.push(templateLine("Meta description", aggregate.templates.description));
  lines.push(templateLine("H1", aggregate.templates.h1));
  lines.push(templateLine("og:title", aggregate.templates.ogTitle));
  lines.push(`- Canonical: ${aggregate.canonical.summary}`);
  lines.push(`- og:image: ${aggregate.ogImage}`);
  lines.push(`- Schema on every sample: ${list(aggregate.schema.always)}`);
  lines.push(`- Schema on some samples: ${list(aggregate.schema.sometimes)}`);
  lines.push(`- Template blocks, in order: ${list(aggregate.blocks.always.map(code))}`);
  lines.push(`- Conditional blocks: ${list(aggregate.blocks.conditional.map(code))}`);
  lines.push("", "Content:", "");
  lines.push(`- Average words: ${n(aggregate.averages.words)}`);
  lines.push(`- Uniqueness: ${aggregate.content.uniqueness === null ? "needs 2+ samples" : pct(aggregate.content.uniqueness)}`);
  for (const sentence of aggregate.content.templated) {
    lines.push(`- Templated sentence: ${code(sentence.skeleton)} (e.g. "${sentence.example}")`);
  }
  if (aggregate.content.boilerplate.length) lines.push(`- Boilerplate sentences: ${aggregate.content.boilerplate.length}`);
  for (const table of aggregate.tables) lines.push(`- Table: ${table.rows} rows, headers ${list(table.headers)}`);
  lines.push(
    "",
    `Averages: ${n(aggregate.averages.internalLinks)} internal links, ${n(aggregate.averages.externalLinks)} external links, ${n(aggregate.averages.images)} images, ${n(aggregate.averages.scripts)} scripts, ${n(aggregate.averages.htmlKb)} KB HTML, ${n(aggregate.averages.responseMs)} ms response.`,
  );
  if (aggregate.outgoing.length) {
    lines.push("", "Links out:", "");
    for (const edge of aggregate.outgoing.slice(0, 15)) lines.push(`- ${code(edge.pattern)}: ${n(edge.links)} links from ${edge.pages} of ${aggregate.analysed} pages`);
  }
  if (data.length) {
    lines.push("", "Signals:", "");
    lines.push(`- Ads: ${data.map((d) => d.signals.ads.count).join(", ")} per page`);
    const redirects = [...new Set(data.flatMap((d) => d.links.affiliate.redirectPaths.map((r) => r.url)))];
    if (redirects.length) lines.push(`- Affiliate redirects (recorded, not fetched): ${list(redirects.slice(0, 8))}`);
    const params = [...new Set(data.flatMap((d) => Object.keys(d.links.affiliate.trackingParams)))];
    if (params.length) lines.push(`- Tracking parameters: ${list(params)}`);
    const messaging = [...new Set(data.flatMap((d) => d.links.messaging.map((m) => m.kind)))];
    if (messaging.length) lines.push(`- Messaging and social: ${list(messaging)}`);
    lines.push(`- Niche: ${list([...new Set(data.map((d) => d.niche.niche))])}`);
    const sports = data.map((d) => d.niche.sports).filter((s) => s !== null);
    if (sports.length) {
      lines.push(`- Fixtures: ${list([...new Set(sports.flatMap((s) => s.fixtures))].slice(0, 6))}`);
      lines.push(`- Markets: ${list([...new Set(sports.flatMap((s) => s.markets))])}`);
      lines.push(`- Bookmakers: ${list([...new Set(sports.flatMap((s) => s.bookmakers))])}`);
      lines.push(`- Odds examples: ${list([...new Set(sports.flatMap((s) => s.odds.examples))].slice(0, 10))}`);
      lines.push(`- Acca terms: ${list([...new Set(sports.flatMap((s) => s.accaTerms))])}`);
    }
    lines.push("", "Validators:", "");
    for (const page of result.pages) {
      if (!page.data) continue;
      const v = page.data.perf.validators;
      lines.push(`- ${page.url}: [PageSpeed Insights](${v.pageSpeed}), [Rich Results Test](${v.richResults}), [Schema Markup Validator](${v.schemaValidator})`);
    }
  }
  const own = issuesForPattern(issues, result.pattern);
  if (own.length) {
    lines.push("", "Issues:", "");
    for (const item of own) lines.push(`- ${item.severity}: ${item.title}`);
  }
  if (result.trimmed.length) lines.push("", ...result.trimmed.map((note) => `Note: ${note}`));
  lines.push("");
  return lines;
}

export function buildReport(state: AnalysisState): string {
  const { map, site } = state;
  const { issues, blocked } = findIssues(state);
  const allPages = [...state.patterns.flatMap((result) => result.pages), ...(site ? [site.homepage] : [])];
  const data = analysedData(allPages);
  const stack = stackSummary(allPages);
  const lines: string[] = [];

  lines.push(`# Sitemapper report: ${map.host}`, "");
  lines.push(`Generated ${state.generatedAt.slice(0, 16).replace("T", " ")} UTC from ${link(map.origin + "/")}.`, "");

  // Summary
  lines.push("## Summary", "");
  lines.push(`- Pages: ${n(map.total)} (${map.source === "sitemap" ? `from ${map.sitemaps.length} ${map.sitemaps.length === 1 ? "sitemap" : "sitemaps"}` : "found by following links"}${map.truncated ? ", list truncated" : ""})`);
  lines.push(`- Patterns: ${n(map.groups.length)}`);
  lines.push(`- Largest patterns: ${list(map.groups.slice(0, 5).map((g) => `${code(g.pattern)} ${n(g.count)} (${g.share}%)`))}`);
  lines.push(`- Stack: ${list([...stack.cms, ...stack.frameworks].map((item) => item.name), "not identified")}`);
  lines.push(`- Hosting/CDN: ${list(stack.hosting.map((item) => item.name), "not identified")}`);
  lines.push(`- Rendering: ${stack.rendering.server} server-rendered, ${stack.rendering.client} mostly client-rendered`);
  lines.push(`- Schema types: ${list(stack.schemaTypes.map((item) => `${item.type} (${item.pages})`))}`);
  lines.push(`- Monetisation: ${monetisation(data).join("; ")}`);
  lines.push(`- Trust: ${trust(data).join("; ")}`);
  lines.push(`- Top issues: ${list(issues.slice(0, 5).map((item) => `${item.title} (${item.severity})`))}`);
  lines.push("");

  // Site files
  lines.push("## Site files", "");
  if (site) {
    const r = site.robots;
    lines.push(`- robots.txt: ${r.present ? `present, ${r.groups.length} user-agent groups` : `missing (status ${r.status})`}`);
    const star = r.groups.find((group) => group.agents.includes("*"));
    if (star) lines.push(`- Disallowed for all agents: ${list(star.disallow.slice(0, 20).map(code))}${star.crawlDelay !== null ? `; crawl-delay ${star.crawlDelay}` : ""}`);
    lines.push(`- Declared sitemaps: ${list(r.sitemaps.map(link))}`);
    lines.push(`- AI crawlers: ${list(r.aiBots.map((bot) => `${bot.bot} ${bot.access}`))}`);
  } else {
    lines.push("- Site checks weren't run.");
  }
  lines.push(`- Sitemaps read: ${map.sitemaps.length}`);
  for (const stat of map.sitemapStats.slice(0, 20)) {
    const ext = Object.entries(stat.extensions).filter(([, used]) => used).map(([name]) => name);
    lines.push(
      `  - ${link(stat.url)}: ${stat.kind}, ${n(stat.urls)} entries, ${n(stat.withLastmod)} with lastmod (${day(stat.oldestLastmod)} to ${day(stat.newestLastmod)}, ${stat.distinctLastmod} distinct)${ext.length ? `, extensions ${ext.join(", ")}` : ""}${stat.autoLastmod ? ", lastmod looks auto-generated" : ""}`,
    );
  }
  if (site) {
    const f = site.files;
    const ads = (label: string, file: typeof f.adsTxt) =>
      `- ${label}: ${file.present ? `present, ${file.lines} lines, ${file.direct} DIRECT, ${file.reseller} RESELLER, ${file.domains.length} ad systems${file.ownerDomain ? `, OWNERDOMAIN ${file.ownerDomain}` : ""}${file.managerDomain ? `, MANAGERDOMAIN ${file.managerDomain}` : ""}` : `missing (${file.note ?? `status ${file.status}`})`}`;
    lines.push(ads("ads.txt", f.adsTxt));
    lines.push(ads("app-ads.txt", f.appAdsTxt));
    lines.push(`- llms.txt: ${f.llmsTxt.present ? `present, ${n(f.llmsTxt.bytes)} bytes` : `missing (${f.llmsTxt.note ?? ""})`}`);
    lines.push(`- security.txt: ${f.securityTxt.present ? "present" : `missing (${f.securityTxt.note ?? ""})`}`);
    lines.push(`- humans.txt: ${f.humansTxt.present ? "present" : `missing (${f.humansTxt.note ?? ""})`}`);
    lines.push(`- Manifest: ${f.manifest.present ? `present${f.manifest.name ? ` (${f.manifest.name})` : ""}` : f.manifest.note ?? "missing"}`);
  }
  lines.push("");

  // Host behaviour
  lines.push("## Host behaviour", "");
  if (site) {
    const h = site.host;
    lines.push(`- HTTPS: ${h.https.redirectsToHttps ? `http redirects to https in ${h.https.hops} ${h.https.hops === 1 ? "hop" : "hops"}` : `http doesn't redirect to https (status ${h.https.status}${h.https.error ? `, ${h.https.error}` : ""})`}`);
    lines.push(`- Canonical host: ${h.canonicalHost.winner}. ${h.canonicalHost.note}`);
    lines.push(`- Trailing slash: ${h.trailingSlash ? h.trailingSlash.note : "not checked"}`);
    lines.push(`- 404 handling: ${h.notFound.kind}. ${h.notFound.note}`);
    const hd = site.headers;
    lines.push(`- Headers: server ${hd.server || "n/a"}; x-powered-by ${hd.poweredBy || "n/a"}; cache-control ${hd.cacheControl || "n/a"}; cache status ${hd.cfCacheStatus || hd.vercelCache || hd.xCache || "n/a"}; CSP ${yes(hd.contentSecurityPolicy)}; HSTS ${yes(hd.strictTransportSecurity)}`);
  } else {
    lines.push("- Not checked.");
  }
  lines.push("");

  // Stack and third parties
  lines.push("## Stack and third parties", "");
  for (const [label, items] of [["Frameworks", stack.frameworks], ["CMS and plugins", stack.cms], ["Hosting/CDN", stack.hosting]] as const) {
    lines.push(`- ${label}: ${list(items.map((item) => `${item.name} (${item.pages} of ${stack.pages} pages)`), "not identified")}`);
  }
  const categories = [...new Set(stack.thirdParties.map((party) => party.category))];
  for (const category of categories) {
    const parties = stack.thirdParties.filter((party) => party.category === category);
    lines.push(`- ${category}: ${list(parties.map((party) => `${party.name ? `${party.name} ` : ""}${code(party.host)}`))}`);
  }
  const homeTech = site?.homepage.data?.tech;
  if (homeTech) {
    const ids = Object.entries(homeTech.tagIds).filter(([, values]) => values.length);
    if (ids.length) lines.push(`- Tag IDs: ${ids.map(([kind, values]) => `${kind} ${values.join(", ")}`).join("; ")}`);
    if (homeTech.embedded.apiHosts.length) lines.push(`- API hosts in inline scripts: ${list(homeTech.embedded.apiHosts.map(code))}`);
    if (homeTech.embedded.nextDataKeys.length) lines.push(`- __NEXT_DATA__ pageProps keys: ${list(homeTech.embedded.nextDataKeys.map(code))}`);
  }
  lines.push(`- Niche split: ${list(stack.niches.map((item) => `${item.niche} (${item.pages})`))}`);
  lines.push("");

  // Pattern table
  lines.push("## Patterns", "");
  lines.push("| pattern | pages | share | sampled | title template | schema types | avg words | uniqueness | issues |");
  lines.push("| --- | ---: | ---: | ---: | --- | --- | ---: | ---: | ---: |");
  for (const group of map.groups) {
    const result = state.patterns.find((item) => item.pattern === group.pattern);
    if (!result) continue;
    const a = result.aggregate;
    lines.push(
      `| ${cell(code(group.pattern))} | ${n(group.count)} | ${group.share}% | ${a.sampled} | ${cell(a.templates.title.template ? code(a.templates.title.template) : "none")} | ${cell(list([...a.schema.always, ...a.schema.sometimes]))} | ${n(a.averages.words)} | ${a.content.uniqueness === null ? "n/a" : pct(a.content.uniqueness)} | ${issuesForPattern(issues, group.pattern).length} |`,
    );
  }
  const notAnalysed = map.groups.length - state.patterns.length;
  if (notAnalysed > 0) lines.push("", `${n(notAnalysed)} smaller patterns weren't analysed.`);
  lines.push("");

  // One section per analysed pattern
  lines.push("## Pattern details", "");
  for (const group of map.groups) {
    const result = state.patterns.find((item) => item.pattern === group.pattern);
    if (result) lines.push(...patternSection(result, state, issues));
  }

  // Link map
  const linkMap = buildLinkMap(state.patterns, site?.homepage ?? null, map.groups.map((group) => group.pattern));
  lines.push("## Link map", "");
  if (linkMap.homepageTargets.length) {
    lines.push(`- Homepage links to: ${list(linkMap.homepageTargets.map((target) => `${code(target.pattern)} (${target.links})`))}`);
  }
  const sources = [...new Set(linkMap.edges.map((edge) => edge.source))];
  for (const source of sources) {
    const edges = linkMap.edges.filter((edge) => edge.source === source);
    lines.push(`- ${code(source)} links to ${list(edges.slice(0, 12).map((edge) => `${code(edge.target)} (${edge.links})`))}`);
  }
  lines.push(`- Patterns no sampled page links to: ${list(linkMap.unlinked.slice(0, 40).map(code))}`);
  lines.push("");

  lines.push("## Linked but not in the sitemap", "");
  if (linkMap.notInSitemap.length) for (const url of linkMap.notInSitemap.slice(0, 100)) lines.push(`- ${link(url)}`);
  else lines.push("None found.");
  lines.push("");

  // Issues
  lines.push("## Issues", "");
  if (!issues.length) lines.push("No issues found in the sampled pages.");
  for (const severity of ["high", "medium", "low"] as const) {
    const items = issues.filter((item) => item.severity === severity);
    if (!items.length) continue;
    lines.push(`### ${severity[0].toUpperCase()}${severity.slice(1)}`, "");
    for (const item of items) {
      lines.push(`- **${item.title}.** ${item.explanation} Patterns: ${list(item.patterns.map(code))}.`);
      for (const url of item.examples) lines.push(`  - ${link(url)}`);
    }
    lines.push("");
  }

  // Method and limits
  lines.push("## Method and limits", "");
  const fetched = allPages.filter((page) => page.outcome !== "robots").length;
  lines.push(`- Analysed ${state.patterns.length} patterns with up to ${state.pagesPerPattern} pages each (from the start, middle and end of each group), plus the homepage: ${fetched} pages requested, ${data.length} analysed.`);
  lines.push(`- Site checks: robots.txt, ads.txt, app-ads.txt, llms.txt, security.txt, humans.txt, manifest, http/https, www/bare, trailing slash and a made-up URL.`);
  const skipped = [...new Set([...(site?.skippedByRobots ?? []), ...allPages.filter((page) => page.outcome === "robots").map((page) => page.url)])];
  lines.push(`- Skipped because robots.txt disallows them: ${skipped.length ? "" : "none"}`);
  for (const url of skipped.slice(0, 20)) lines.push(`  - ${link(url)}`);
  lines.push(`- Blocked by bot protection: ${blocked.length ? "" : "none"}`);
  for (const page of blocked.slice(0, 20)) lines.push(`  - ${link(page.url)} (${page.pattern})`);
  lines.push("- Requests identify as SitemapperBot/1.0, with at most 4 in flight and a pause between batches. Outbound and affiliate links are recorded, never requested.");
  lines.push("- Performance numbers are proxies from the HTML and response time, not Core Web Vitals. Use the PageSpeed Insights links for real measurements.");
  lines.push("");
  return lines.join("\n");
}
