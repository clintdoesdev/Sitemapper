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

export function findIssues(state: AnalysisState): { issues: Issue[]; blocked: BlockedPage[] } {
  const all: PageAnalysis[] = state.patterns.flatMap((result) => result.pages);
  if (state.site?.homepage) all.push(state.site.homepage);
  const analysed = all.filter((page): page is Analysed => page.data !== null);
  const hits = (test: (page: Analysed) => boolean) =>
    analysed.filter(test).map((page) => ({ pattern: page.pattern, url: page.url }));
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

  // Titles and descriptions.
  out.push(issue("missing-title", "high", "Missing title", "Pages without a <title> rarely rank and show a generated title in results.", hits((p) => !p.data.head.title)));
  const titles = new Map<string, Hit[]>();
  for (const page of analysed) {
    const title = page.data.head.title.trim().toLowerCase();
    if (!title) continue;
    titles.set(title, [...(titles.get(title) ?? []), { pattern: page.pattern, url: page.url }]);
  }
  const duplicates = [...titles.values()].filter((list) => new Set(list.map((hit) => hit.url)).size > 1).flat();
  out.push(issue("duplicate-titles", "medium", "Duplicate titles", "Different sampled pages share the exact same title, which makes them compete for the same queries.", duplicates));
  out.push(issue("long-titles", "low", "Titles over 60 characters", "Long titles are usually cut off in search results.", hits((p) => p.data.head.titleLength > 60)));
  out.push(issue("missing-description", "medium", "Missing meta description", "Without one, search engines pick a snippet from the page text.", hits((p) => !p.data.head.description)));
  out.push(issue("long-descriptions", "low", "Meta descriptions over 160 characters", "Long descriptions are usually cut off in search results.", hits((p) => p.data.head.descriptionLength > 160)));

  // Headings.
  out.push(issue("missing-h1", "medium", "Missing H1", "The page has no main heading.", hits((p) => p.data.structure.h1Count === 0)));
  out.push(issue("multiple-h1", "low", "More than one H1", "Several H1s blur what the page is about.", hits((p) => p.data.structure.h1Count > 1)));

  // Canonicals and indexing.
  out.push(issue("canonical-missing", "medium", "Canonical missing", "Without a canonical, duplicate URL variants (parameters, slashes) can be indexed separately.", hits((p) => p.data.head.canonical.kind === "missing")));
  out.push(issue("canonical-elsewhere", "medium", "Canonical points to another URL", "The page tells search engines a different URL is the main version, so this one may not be indexed.", hits((p) => p.data.head.canonical.kind === "other")));
  if (state.map.source === "sitemap") {
    const noindex = (p: Analysed) => /noindex/i.test(`${p.data.head.robots} ${p.data.head.googlebot} ${p.data.head.xRobotsTag}`);
    out.push(issue("noindex-in-sitemap", "high", "Noindex pages listed in the sitemap", "The sitemap asks for these pages to be crawled while the pages ask not to be indexed.", hits(noindex)));
  }

  // Structured data.
  out.push(issue("invalid-jsonld", "medium", "Invalid JSON-LD", "At least one structured-data block doesn't parse, so search engines ignore it.", hits((p) => p.data.schema.blocks.some((block) => !block.valid))));
  out.push(issue("faq-not-visible", "medium", "FAQ schema questions not visible", "FAQ structured data should match questions shown on the page; hidden ones can be treated as spam.", hits((p) => p.data.schema.faq.notVisible.length > 0)));

  // Rendering and content.
  out.push(issue("client-rendered", "high", "Mostly client-rendered", "The HTML has almost no main content; crawlers that don't run JavaScript see an empty page.", hits((p) => p.data.tech.rendering === "mostly client-rendered")));
  const thin: Hit[] = [];
  for (const result of state.patterns) {
    const uniqueness = result.aggregate.content.uniqueness;
    if (uniqueness === null || uniqueness >= 0.3) continue;
    for (const page of result.pages) {
      if (page.data && page.data.structure.main.words < 250) thin.push({ pattern: page.pattern, url: page.url });
    }
  }
  out.push(issue("thin-pages", "medium", "Thin, templated pages", "Under 250 words with less than 30% unique text across samples: pages that mostly repeat each other.", thin));

  // Images and resources.
  out.push(issue("images-missing-alt", "low", "Images missing alt text", "Images without an alt attribute are invisible to screen readers and image search.", hits((p) => p.data.structure.images.missingAlt > 0)));
  out.push(issue("images-missing-dimensions", "low", "Images missing width or height", "Images without dimensions shift the layout as they load.", hits((p) => p.data.structure.images.missingDimensions > 0)));
  out.push(issue("mixed-content", "medium", "http resources on https pages", "Browsers block or warn about insecure resources on secure pages.", hits((p) => p.data.perf.mixedContent.length > 0)));

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
  out.push(issue("internal-nofollow", "low", "Nofollow on internal links", "Nofollow on your own links stops link value flowing to your own pages.", hits((p) => p.data.links.internalNofollow > 0)));
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
