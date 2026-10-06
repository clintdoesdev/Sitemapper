/** Export builders for the analysis. Browser-safe. */

import { architectureTree, buildLinkMap, stackSummary } from "./aggregate";
import type { AnalysisState } from "./analysis-types";
import type { PageAnalysis } from "./extract/types";
import { findIssues, pageIssueTitles } from "./issues";

export const PAGE_DATA_HEADER = [
  "url", "pattern", "status", "title", "title_length", "description_length", "h1", "canonical", "robots",
  "schema_types", "words", "uniqueness", "internal_links", "external_links", "images", "scripts", "html_kb",
  "response_ms", "rendering", "niche", "issues",
];

/** One row per sampled page (and the homepage). */
export function pageDataRows(state: AnalysisState): string[][] {
  const rows: { page: PageAnalysis; uniqueness: number | null }[] = [];
  if (state.site) rows.push({ page: state.site.homepage, uniqueness: null });
  for (const result of state.patterns) {
    for (const page of result.pages) rows.push({ page, uniqueness: result.aggregate.content.uniqueness });
  }
  return rows.map(({ page, uniqueness }) => {
    const data = page.data;
    const status = page.outcome === "ok" ? String(page.status) : `${page.status || ""} ${page.message ?? page.outcome}`.trim();
    const issues = pageIssueTitles(page, { source: state.map.source, uniqueness });
    if (!data) return [page.url, page.pattern, status, ...new Array<string>(PAGE_DATA_HEADER.length - 4).fill(""), issues.join("; ")];
    return [
      page.url,
      page.pattern,
      status,
      data.head.title,
      String(data.head.titleLength),
      String(data.head.descriptionLength),
      data.structure.headings.find((heading) => heading.level === 1)?.text ?? "",
      data.head.canonical.kind === "missing" ? "missing" : `${data.head.canonical.kind}: ${data.head.canonical.href}`,
      [data.head.robots, data.head.xRobotsTag && `X-Robots-Tag: ${data.head.xRobotsTag}`].filter(Boolean).join("; "),
      data.schema.types.join("; "),
      String(data.structure.main.words),
      uniqueness === null ? "" : String(Math.round(uniqueness * 100)),
      String(data.links.internal),
      String(data.links.external),
      String(data.structure.images.count),
      String(data.perf.scripts.external + data.perf.scripts.inline),
      String(Math.round((page.bytes / 1024) * 10) / 10),
      String(page.ms),
      data.tech.rendering,
      data.niche.niche,
      issues.join("; "),
    ];
  });
}

/** The full result as one JSON document. */
export function fullJson(state: AnalysisState, groupsWithUrls: readonly { pattern: string; urls: string[] }[]): string {
  const { issues, blocked } = findIssues(state);
  const allPages = [...(state.site ? [state.site.homepage] : []), ...state.patterns.flatMap((result) => result.pages)];
  return JSON.stringify(
    {
      tool: "Sitemapper",
      generatedAt: state.generatedAt,
      map: {
        ...state.map,
        groups: state.map.groups.map((group) => ({
          ...group,
          urls: groupsWithUrls.find((item) => item.pattern === group.pattern)?.urls ?? [],
        })),
      },
      site: state.site,
      pagesPerPattern: state.pagesPerPattern,
      patterns: state.patterns,
      linkMap: buildLinkMap(state.patterns, state.site?.homepage ?? null, state.map.groups.map((group) => group.pattern)),
      architecture: architectureTree(state.map.groups),
      stack: stackSummary(allPages),
      issues,
      blocked,
    },
    null,
    2,
  );
}
