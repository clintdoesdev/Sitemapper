/** Shapes shared by the browser, the issue rules and the report. Types only. */

import type { SitemapStat } from "./crawl";
import type { PageAnalysis } from "./extract/types";
import type { Placeholder } from "./patterns";
import type { SiteReport } from "./site";
import type { PatternAggregate } from "./aggregate";

export type GroupSummary = {
  pattern: string;
  count: number;
  share: number;
  lastmodNewest: string | null;
  lastmodOldest: string | null;
  lastmodCoverage: number;
  placeholders: Placeholder[];
};

export type MapSummary = {
  origin: string;
  host: string;
  source: "sitemap" | "crawl";
  total: number;
  sitemaps: string[];
  sitemapStats: SitemapStat[];
  truncated: boolean;
  notes: string[];
  groups: GroupSummary[];
};

export type PatternResult = {
  pattern: string;
  /** Group size in the map. */
  count: number;
  pages: PageAnalysis[];
  aggregate: PatternAggregate;
  /** Notes when the server shortened the response. */
  trimmed: string[];
};

export type AnalysisState = {
  map: MapSummary;
  site: SiteReport | null;
  patterns: PatternResult[];
  pagesPerPattern: number;
  generatedAt: string;
};
