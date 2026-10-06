/** Issue rules: pure functions over analysis results. Browser-safe. */

import { buildLinkMap } from "./aggregate";
import type { AnalysisState } from "./analysis-types";
import type { PageAnalysis, PageData } from "./extract/types";

export type Severity = "high" | "medium" | "low";

export type Issue = {
  id: string;
  severity: Severity;
  title: string;
  explanation: string;
  patterns: string[];
  examples: string[];
};

export type BlockedPage = { url: string; pattern: string; message: string };

type Hit = { pattern: string; url: string };
type Analysed = PageAnalysis & { data: PageData };

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

function issue(id: string, severity: Severity, title: string, explanation: string, hits: Hit[]): Issue | null {
  if (hits.length === 0) return null;
  return {
    id,
    severity,
    title,
    explanation,
    patterns: [...new Set(hits.map((hit) => hit.pattern))],
    examples: [...new Set(hits.map((hit) => hit.url).filter(Boolean))].slice(0, 3),
  };
}

function plural(count: number, word: string): string {
  return `${count} ${count === 1 ? word : `${word}s`}`;
}

type PageContext = { source: "sitemap" | "crawl"; uniqueness: number | null };
type PageRule = {
  id: string;
  severity: Severity;
  title: string;
  explanation: string;
  test: (page: Analysed, context: PageContext) => boolean;
};

/** Rules that look at one analysed page. Used for the issue list and the page-data CSV. */
const PAGE_RULES: PageRule[] = [
  { id: "missing-title", severity: "high", title: "Missing title", explanation: "Pages without a <title> rarely rank and show a generated title in results.", test: (p) => !p.data.head.title },
  { id: "long-titles", severity: "low", title: "Titles over 60 characters", explanation: "Long titles are usually cut off in search results.", test: (p) => p.data.head.titleLength > 60 },
  { id: "missing-description", severity: "medium", title: "Missing meta description", explanation: "Without one, search engines pick a snippet from the page text.", test: (p) => !p.data.head.description },
  { id: "long-descriptions", severity: "low", title: "Meta descriptions over 160 characters", explanation: "Long descriptions are usually cut off in search results.", test: (p) => p.data.head.descriptionLength > 160 },
  { id: "missing-h1", severity: "medium", title: "Missing H1", explanation: "The page has no main heading.", test: (p) => p.data.structure.h1Count === 0 },
  { id: "multiple-h1", severity: "low", title: "More than one H1", explanation: "Several H1s blur what the page is about.", test: (p) => p.data.structure.h1Count > 1 },
  { id: "canonical-missing", severity: "medium", title: "Canonical missing", explanation: "Without a canonical, duplicate URL variants (parameters, slashes) can be indexed separately.", test: (p) => p.data.head.canonical.kind === "missing" },
  { id: "canonical-elsewhere", severity: "medium", title: "Canonical points to another URL", explanation: "The page tells search engines a different URL is the main version, so this one may not be indexed.", test: (p) => p.data.head.canonical.kind === "other" },
  {
    id: "noindex-in-sitemap",
    severity: "high",
    title: "Noindex pages listed in the sitemap",
    explanation: "The sitemap asks for these pages to be crawled while the pages ask not to be indexed.",
    test: (p, c) => c.source === "sitemap" && /noindex/i.test(`${p.data.head.robots} ${p.data.head.googlebot} ${p.data.head.xRobotsTag}`),
  },
  { id: "invalid-jsonld", severity: "medium", title: "Invalid JSON-LD", explanation: "At least one structured-data block doesn't parse, so search engines ignore it.", test: (p) => p.data.schema.blocks.some((block) => !block.valid) },
  { id: "faq-not-visible", severity: "medium", title: "FAQ schema questions not visible", explanation: "FAQ structured data should match questions shown on the page; hidden ones can be treated as spam.", test: (p) => p.data.schema.faq.notVisible.length > 0 },
  { id: "client-rendered", severity: "high", title: "Mostly client-rendered", explanation: "The HTML has almost no main content; crawlers that don't run JavaScript see an empty page.", test: (p) => p.data.tech.rendering === "mostly client-rendered" },
  {
    id: "thin-pages",
    severity: "medium",
    title: "Thin, templated pages",
    explanation: "Under 250 words with less than 30% unique text across samples: pages that mostly repeat each other.",
    test: (p, c) => c.uniqueness !== null && c.uniqueness < 0.3 && p.data.structure.main.words < 250,
  },
  { id: "images-missing-alt", severity: "low", title: "Images missing alt text", explanation: "Images without an alt attribute are invisible to screen readers and image search.", test: (p) => p.data.structure.images.missingAlt > 0 },
  { id: "images-missing-dimensions", severity: "low", title: "Images missing width or height", explanation: "Images without dimensions shift the layout as they load.", test: (p) => p.data.structure.images.missingDimensions > 0 },
  { id: "mixed-content", severity: "medium", title: "http resources on https pages", explanation: "Browsers block or warn about insecure resources on secure pages.", test: (p) => p.data.perf.mixedContent.length > 0 },
  { id: "internal-nofollow", severity: "low", title: "Nofollow on internal links", explanation: "Nofollow on your own links stops link value flowing to your own pages.", test: (p) => p.data.links.internalNofollow > 0 },
];

/** Issue titles that apply to one sampled page, for the page-data CSV. */
export function pageIssueTitles(page: PageAnalysis, context: PageContext): string[] {
  if (page.outcome === "blocked") return [];
  if (page.outcome === "error" && page.status >= 400) return ["Sampled pages return errors"];
  if (!page.data) return [];
  const titles = PAGE_RULES.filter((rule) => rule.test(page as Analysed, context)).map((rule) => rule.title);
  if (page.redirectChain.length > 1) titles.push("Redirect chains longer than one hop");
  return titles;
}

export function findIssues(state: AnalysisState): { issues: Issue[]; blocked: BlockedPage[] } {
  const all: PageAnalysis[] = state.patterns.flatMap((result) => result.pages);
  if (state.site?.homepage) all.push(state.site.homepage);
  const analysed = all.filter((page): page is Analysed => page.data !== null);
  const out: (Issue | null)[] = [];

  // Bot protection is reported separately; it says nothing about the site's SEO.
  const blocked = all
    .filter((page) => page.outcome === "blocked")
    .map((page) => ({ url: page.url, pattern: page.pattern, message: page.message ?? "" }));

  const errors = all.filter((page) => page.outcome === "error" && page.status >= 400);
  out.push(
    issue(
      "http-errors",
      "high",
      "Sampled pages return errors",
      `${plural(errors.length, "sampled page")} answered with a 4xx or 5xx status, so the sitemap lists URLs that don't work.`,
      errors.map((page) => ({ pattern: page.pattern, url: page.url })),
    ),
  );

  // Per-page rules (titles, descriptions, headings, canonicals, schema, rendering, thin content, images).
  const uniquenessByPattern = new Map(state.patterns.map((result) => [result.pattern, result.aggregate.content.uniqueness]));
  for (const rule of PAGE_RULES) {
    const matched = analysed.filter((page) =>
      rule.test(page, { source: state.map.source, uniqueness: uniquenessByPattern.get(page.pattern) ?? null }),
    );
    out.push(issue(rule.id, rule.severity, rule.title, rule.explanation, matched.map((page) => ({ pattern: page.pattern, url: page.url }))));
  }

  // Duplicate titles across every sampled page.
  const titles = new Map<string, Hit[]>();
  for (const page of analysed) {
    const title = page.data.head.title.trim().toLowerCase();
    if (!title) continue;
    titles.set(title, [...(titles.get(title) ?? []), { pattern: page.pattern, url: page.url }]);
  }
  const duplicates = [...titles.values()].filter((list) => new Set(list.map((hit) => hit.url)).size > 1).flat();
  out.push(issue("duplicate-titles", "medium", "Duplicate titles", "Different sampled pages share the exact same title, which makes them compete for the same queries.", duplicates));

  // Images and resources.

  // Redirects and host handling.
  const chained = all.filter((page) => page.redirectChain.length > 1).map((page) => ({ pattern: page.pattern, url: page.url }));
  const site = state.site;
  if (site) {
    for (const check of [site.host.https, site.host.canonicalHost]) {
      if (check.hops > 1) chained.push({ pattern: "(host)", url: check.url });
    }
  }
  out.push(issue("redirect-chains", "medium", "Redirect chains longer than one hop", "Each extra hop slows crawling and leaks a little link value.", chained));
  if (site) {
    if (site.host.notFound.kind === "soft 404" || site.host.notFound.kind === "redirect to homepage") {
      out.push(
        issue(
          "soft-404",
          "medium",
          site.host.notFound.kind === "soft 404" ? "Soft 404s" : "Missing pages redirect to the homepage",
          `${site.host.notFound.note} Search engines treat this as a soft 404 and may waste crawl budget on dead URLs.`,
          [{ pattern: "(host)", url: site.host.notFound.url }],
        ),
      );
    }
    const inconsistent: Hit[] = [];
    if (site.origin.startsWith("https:") && site.host.https.status > 0 && !site.host.https.redirectsToHttps && !site.host.https.error) {
      inconsistent.push({ pattern: "(host)", url: site.host.https.url });
    }
    if (site.host.canonicalHost.winner === "both serve pages") inconsistent.push({ pattern: "(host)", url: site.host.canonicalHost.url });
    out.push(issue("host-handling", "medium", "Inconsistent http/https or www handling", "Several hostnames or protocols serve the same pages instead of redirecting to one version.", inconsistent));
  }

  // Sitemaps and internal linking.
  const autoSitemaps = state.map.sitemapStats.filter((stat) => stat.autoLastmod);
  out.push(
    issue(
      "lastmod-auto",
      "low",
      "Sitemap lastmod looks auto-generated",
      "90% or more of entries share one lastmod value, so it doesn't tell crawlers what really changed.",
      autoSitemaps.map((stat) => ({ pattern: "(sitemap)", url: stat.url })),
    ),
  );
  const linkMap = buildLinkMap(state.patterns, site?.homepage ?? null, state.map.groups.map((group) => group.pattern));
  if (state.map.source === "sitemap") {
    const unlisted = analysed.filter((page) => page.data.links.unmatchedInternal.length > 0);
    out.push(
      issue(
        "links-not-in-sitemap",
        "low",
        "Internal links to URLs not in the sitemap",
        `Sampled pages link to ${plural(linkMap.notInSitemap.length, "internal URL")} that match no sitemap pattern.`,
        unlisted.flatMap((page) => page.data.links.unmatchedInternal.slice(0, 1).map((url) => ({ pattern: page.pattern, url }))),
      ),
    );
  }
  const analysedPatterns = new Set(state.patterns.map((result) => result.pattern));
  if (analysedPatterns.size > 0) {
    out.push(
      issue(
        "unlinked-patterns",
        "low",
        "Patterns no sampled page links to",
        "No analysed page or the homepage links to these patterns. Sampling can miss links, so check before acting.",
        linkMap.unlinked.map((pattern) => ({
          pattern,
          // Only analysed patterns have a real sample URL to show.
          url: state.patterns.find((result) => result.pattern === pattern)?.pages[0]?.url ?? "",
        })),
      ),
    );
  }

  const issues = out
    .filter((value): value is Issue => value !== null)
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return { issues, blocked };
}

/** Issues that name a given pattern. */
export function issuesForPattern(issues: readonly Issue[], pattern: string): Issue[] {
  return issues.filter((item) => item.patterns.includes(pattern));
}
