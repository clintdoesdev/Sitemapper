"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronIcon,
  copyText,
  ExtractIcon,
  downloadCsv,
  formatNumber,
  plural,
  secondaryButton,
  toAbsolute,
  type Group,
} from "./ui";
import {
  CONTENT_CSV_HEADER,
  contentCsvCells,
  ContentsSection,
  ExtractionStatus,
  JobLink,
  type ContentsMap,
  type ExtractionJob,
} from "./contents";
import type { ExtractResult } from "@/lib/contents";
import type { JobStatus } from "@/lib/jobs";
import { aggregatePattern, buildLinkMap, pickSamples, stackSummary } from "@/lib/aggregate";
import type { AnalysisState, MapSummary, PatternResult } from "@/lib/analysis-types";
import type { SitemapStat } from "@/lib/crawl";
import type { PageAnalysis } from "@/lib/extract/types";
import { findIssues, issuesForPattern } from "@/lib/issues";
import type { SiteReport } from "@/lib/site";
import { Segmented } from "@/components/bits";
import { DownloadPanel } from "@/components/DownloadPanel";
import { IssuesSection } from "@/components/IssuesSection";
import { LinkMapSection } from "@/components/LinkMapSection";
import { MethodLimits } from "@/components/MethodLimits";
import { PatternPanel } from "@/components/PatternPanel";
import { SiteSection } from "@/components/SiteSection";

type MapResult = {
  origin: string;
  source: "sitemap" | "crawl";
  sitemaps: string[];
  sitemapStats?: SitemapStat[];
  truncated: boolean;
  notes: string[];
  total: number;
  groups: Group[];
  /** Rebuilt from a job link: only the pages that job read. */
  restored?: boolean;
};

/** The analysis covers the largest patterns, up to this many. */
const MAX_ANALYSED_PATTERNS = 20;
/** /api/analyse calls in flight; each fetches 2 pages at a time, so never more than 4. */
const ANALYSE_WORKERS = 2;
const PAGES_PER_PATTERN = [
  { value: 1, label: "1" },
  { value: 2, label: "2" },
  { value: 3, label: "3" },
] as const;
type RunState = {
  state: "running" | "done" | "stopped" | "failed";
  done: number;
  total: number;
  active: string[];
  errors: string[];
};
/** Most pages one extraction run covers; running again continues with the rest. */
const MAX_EXTRACT_PAGES = 5_000;
const EXTRACT_CHUNK = 20;
const RENDER_CHUNK = 4;
/** Requests in flight at once, for plain reads and for browser renders. */
const EXTRACT_WORKERS = 3;
/** Temporary failures are retried this many times, more slowly each round. */
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000];
const RETRY_CHUNK = 5;
const MAX_PAUSE_MS = 60_000;
/** How often an open page checks on a job running on the server. */
const JOB_POLL_MS = 3_000;

function jobHref(id: string): string {
  return `${window.location.origin}${window.location.pathname}?job=${encodeURIComponent(id)}`;
}

function setJobParam(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("job", id);
  else url.searchParams.delete("job");
  window.history.replaceState(null, "", url);
}

/** Rebuilds a page list from a job's pages, grouped by the patterns they had when the job started. */
function restoredResult(origin: string, items: [string, string][]): MapResult {
  const byPattern = new Map<string, string[]>();
  for (const [url, pattern] of items) {
    const urls = byPattern.get(pattern) ?? [];
    urls.push(url.startsWith(`${origin}/`) ? url.slice(origin.length) : url);
    byPattern.set(pattern, urls);
  }
  const groups = [...byPattern.entries()]
    .map(([pattern, urls]) => ({ pattern, count: urls.length, urls, share: urls.length / Math.max(items.length, 1) }))
    .sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern));
  return { origin, source: "sitemap", sitemaps: [], truncated: false, notes: [], total: items.length, groups, restored: true };
}

/** Waits `ms`, or rejects as soon as `signal` aborts. */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}
const RENDER_WORKERS = 2;

/** Runs `work` over every item with at most `workers` running at once. */
async function inPool<T>(items: T[], workers: number, work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(workers, items.length) }, async () => {
      while (next < items.length) await work(items[next++]);
    }),
  );
}

function chunks<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, index * size + size),
  );
}

/** An error message from the Sitemapper API, safe to show as is. */
class ServerError extends Error {}

const CONTOURS = [
  "M373.9 230.0C374.8 234.5 371.6 240.1 368.8 244.6C366.0 249.0 362.3 254.3 357.2 256.6C352.1 258.8 344.0 257.8 338.2 257.9C332.3 258.0 328.1 257.3 322.1 257.2C316.0 257.1 306.9 259.5 302.1 257.3C297.4 255.0 295.0 248.2 293.6 243.7C292.2 239.1 293.6 234.6 293.6 230.0C293.7 225.4 291.8 220.5 293.7 216.4C295.5 212.2 300.3 208.7 304.7 205.3C309.1 201.8 314.1 196.8 319.9 195.5C325.7 194.2 334.6 195.0 339.5 197.5C344.5 200.0 345.8 207.4 349.7 210.7C353.6 214.1 359.1 214.4 363.1 217.6C367.1 220.8 372.9 225.5 373.9 230.0Z",
  "M425.3 234.0C426.7 243.9 415.1 256.3 407.5 265.4C399.9 274.5 390.8 283.7 379.8 288.6C368.9 293.4 353.9 293.6 341.7 294.4C329.5 295.3 319.6 293.9 306.5 293.8C293.4 293.7 273.3 298.7 262.9 293.7C252.6 288.7 247.2 273.8 244.5 263.9C241.7 253.9 246.8 244.1 246.4 234.0C246.1 223.9 239.0 212.7 242.4 203.4C245.8 194.1 256.8 185.0 266.9 178.1C277.0 171.3 290.1 164.0 302.9 162.0C315.7 160.1 333.2 161.4 343.8 166.4C354.4 171.5 357.4 185.8 366.6 192.4C375.7 199.0 389.0 199.0 398.8 205.9C408.6 212.9 423.8 224.1 425.3 234.0Z",
  "M480.2 238.0C481.0 253.4 456.8 271.9 443.2 285.0C429.5 298.1 414.8 308.9 398.5 316.7C382.2 324.6 363.6 329.4 345.5 332.0C327.5 334.7 310.6 332.8 290.3 332.5C270.0 332.2 239.6 338.2 223.7 330.2C207.8 322.1 198.9 299.6 194.9 284.2C191.0 268.8 200.8 253.8 199.8 238.0C198.9 222.2 184.6 204.4 189.3 189.7C194.0 175.0 211.6 159.4 227.9 149.9C244.2 140.5 267.3 134.8 287.2 132.9C307.1 130.9 330.9 131.6 347.2 138.2C363.6 144.7 370.3 162.9 385.5 172.0C400.7 181.1 422.8 181.7 438.6 192.7C454.4 203.7 479.4 222.6 480.2 238.0Z",
  "M534.7 242.0C533.3 262.8 494.2 286.3 474.1 302.9C453.9 319.4 434.5 329.9 413.8 341.5C393.2 353.1 373.6 366.9 350.2 372.4C326.7 377.9 300.7 375.6 273.2 374.5C245.7 373.4 206.6 377.5 185.3 365.9C164.0 354.2 150.7 325.2 145.4 304.6C140.0 283.9 154.7 263.5 153.1 242.0C151.5 220.5 129.6 195.8 135.6 175.8C141.5 155.7 166.1 133.0 188.9 121.7C211.8 110.4 245.9 109.9 272.8 108.1C299.7 106.3 327.7 104.5 350.3 111.1C373.0 117.6 386.6 136.4 408.6 147.6C430.5 158.8 461.1 162.4 482.1 178.1C503.1 193.9 536.0 221.2 534.7 242.0Z",
  "M584.2 246.0C579.6 272.0 526.2 299.1 500.0 318.9C473.9 338.6 451.4 348.4 427.5 364.7C403.5 381.1 384.8 407.9 356.1 417.1C327.3 426.3 289.6 422.9 255.0 420.1C220.5 417.2 175.0 415.8 148.6 399.9C122.2 384.0 103.7 350.3 96.5 324.7C89.3 299.0 107.8 273.1 105.5 246.0C103.2 218.9 75.0 187.4 82.6 162.1C90.1 136.8 121.2 106.8 150.7 94.1C180.1 81.5 225.5 88.3 259.3 86.5C293.1 84.6 324.1 77.9 353.7 83.2C383.3 88.4 408.0 104.7 437.0 118.0C465.9 131.2 502.9 141.5 527.4 162.9C552.0 184.2 588.7 220.0 584.2 246.0Z",
  "M625.1 250.0C616.9 280.9 553.0 310.4 522.5 333.5C492.0 356.7 468.5 366.5 442.0 388.8C415.5 411.0 397.9 453.7 363.5 467.1C329.2 480.4 277.4 474.7 236.0 468.7C194.6 462.6 146.2 451.6 115.0 430.9C83.9 410.1 58.9 374.3 49.1 344.2C39.3 314.1 59.3 282.5 56.3 250.0C53.4 217.5 21.7 179.5 31.3 149.1C40.8 118.7 77.6 81.4 113.4 67.6C149.2 53.7 205.4 68.3 246.1 65.9C286.8 63.5 320.3 50.0 357.7 52.9C395.1 55.8 434.8 67.5 470.5 83.3C506.1 99.2 545.7 120.3 571.5 148.1C597.3 175.8 633.3 219.1 625.1 250.0Z",
  "M655.6 254.0C644.5 289.5 577.2 321.0 544.6 348.1C512.0 375.2 488.7 387.4 460.1 416.3C431.4 445.3 413.0 505.0 372.5 522.0C331.9 539.0 264.4 529.1 216.6 518.4C168.8 507.7 121.1 483.6 85.6 457.7C50.1 431.8 17.0 397.0 3.5 363.1C-10.0 329.1 8.0 291.7 4.4 254.0C0.9 216.3 -30.1 172.2 -18.0 136.9C-5.9 101.5 35.2 57.3 77.0 41.8C118.7 26.4 185.0 47.9 232.6 44.2C280.2 40.4 316.8 19.3 362.7 19.5C408.5 19.6 466.2 25.9 507.6 45.1C549.1 64.4 586.6 100.1 611.2 134.9C635.9 169.7 666.7 218.5 655.6 254.0Z",
];

function StudyFirst({ what }: { what: string }) {
  return (
    <p className="mt-6 max-w-[52ch] border-l-2 border-rule pl-3 text-sm text-muted">
      To see {what}, press <span className="text-ink">Study sample pages</span> under &ldquo;Want more detail?&rdquo; above.
    </p>
  );
}

function Contours() {
  return (
    <svg
      aria-hidden="true"
      viewBox="-110 -90 860 680"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      className="pointer-events-none absolute -top-44 -right-56 w-[520px] text-rule opacity-70 sm:-top-52 sm:-right-64 sm:w-[680px]"
    >
      {CONTOURS.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

export default function Home() {
  const [domain, setDomain] = useState("");
  // Off by default: requests announce themselves as SitemapperBot.
  const [asBrowser, setAsBrowser] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MapResult | null>(null);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [contents, setContents] = useState<ContentsMap>(new Map());
  const contentsRef = useRef<ContentsMap>(contents);
  contentsRef.current = contents;
  const [job, setJob] = useState<ExtractionJob | null>(null);
  /** True when this server can read pages in the background, with the page closed. */
  const [serverJobs, setServerJobs] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const extractAbort = useRef<AbortController | null>(null);
  const extracting = job?.state === "running";
  const [pagesPerPattern, setPagesPerPattern] = useState<1 | 2 | 3>(2);
  const [site, setSite] = useState<SiteReport | null>(null);
  const siteRef = useRef<SiteReport | null>(site);
  siteRef.current = site;
  const [siteError, setSiteError] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, PatternResult>>({});
  const [run, setRun] = useState<RunState | null>(null);
  const analysisAbort = useRef<AbortController | null>(null);
  const analysing = run?.state === "running";
  const [view, setView] = useState<"pages" | "problems" | "site" | "links">("pages");

  const deferredFilter = useDeferredValue(filter);

  useEffect(() => {
    return () => {
      extractAbort.current?.abort();
      analysisAbort.current?.abort();
    };
  }, []);

  // Background reading, and a job link opened from another device or later on.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/jobs")
      .then((response) => response.json())
      .then((data: { enabled?: boolean }) => !cancelled && setServerJobs(data.enabled === true))
      .catch(() => undefined);
    const id = new URLSearchParams(window.location.search).get("job");
    if (id) {
      setRestoring(true);
      fetch(`/api/jobs/${encodeURIComponent(id)}/items`)
        .then(async (response) => {
          const data = (await response.json().catch(() => null)) as { origin?: string; items?: [string, string][]; error?: string } | null;
          if (cancelled) return;
          if (!response.ok || !data?.origin || !data.items) {
            setError(data?.error ?? "Couldn't open this job link. Try again in a minute.");
            return;
          }
          const restored = restoredResult(data.origin, data.items);
          setResult(restored);
          setDomain(new URL(data.origin).hostname);
          setOpen(new Set(restored.groups[0] ? [restored.groups[0].pattern] : []));
          setJobId(id);
        })
        .catch(() => !cancelled && setError("Couldn't reach the Sitemapper server. Check your connection and try again."))
        .finally(() => !cancelled && setRestoring(false));
    }
    return () => {
      cancelled = true;
    };
  }, []);

  // Follows a job running on the server: progress every few seconds, and new results as they land.
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let offset = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const pullResults = async (available: number) => {
      while (!cancelled && offset < available) {
        const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/results?offset=${offset}`, { cache: "no-store" });
        const data = (await response.json().catch(() => null)) as { pages?: ExtractResult[]; next?: number } | null;
        if (!response.ok || !data?.pages || typeof data.next !== "number" || data.next <= offset) return;
        const pages = data.pages;
        if (cancelled) return;
        setContents((current) => {
          const next = new Map(current);
          for (const page of pages) next.set(page.url, page);
          return next;
        });
        offset = data.next;
      }
    };
    const poll = async () => {
      try {
        const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { cache: "no-store" });
        const data = (await response.json().catch(() => null)) as (JobStatus & { error?: string }) | null;
        if (cancelled) return;
        if (response.status === 404) {
          setJob((current) => current && { ...current, state: "failed", error: data?.error ?? "This job link has expired." });
          return;
        }
        if (response.ok && data && typeof data.total === "number") {
          await pullResults(data.results);
          if (cancelled) return;
          setJob({
            total: data.total,
            done: data.done,
            rendering: data.rendering,
            retrying: data.retrying,
            failed: data.status === "running" ? 0 : data.failed,
            state: data.status,
            error: data.error,
            skipped: data.skipped,
          });
          if (data.status !== "running") return;
        }
      } catch {
        // Offline for a moment; try again on the next tick.
      }
      if (!cancelled) timer = setTimeout(poll, JOB_POLL_MS);
    };
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);

  // Lower-cased absolute URLs, computed once per result for fast filtering.
  const searchable = useMemo(() => {
    if (!result) return new Map<string, string[]>();
    return new Map(
      result.groups.map((group) => [
        group.pattern,
        group.urls.map((url) => toAbsolute(url, result.origin).toLowerCase()),
      ]),
    );
  }, [result]);

  const visibleGroups = useMemo<Group[]>(() => {
    if (!result) return [];
    const query = deferredFilter.trim().toLowerCase();
    if (!query) return result.groups;
    return result.groups
      .map((group) => {
        const haystack = searchable.get(group.pattern) ?? [];
        const urls = group.urls.filter((_, index) => haystack[index].includes(query));
        return { ...group, count: urls.length, urls };
      })
      .filter((group) => group.count > 0)
      .sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern));
  }, [result, searchable, deferredFilter]);

  const visibleTotal = visibleGroups.reduce((sum, group) => sum + group.count, 0);
  const largest = visibleGroups[0]?.count ?? 0;
  const isFiltering = deferredFilter.trim().length > 0;
  const host = result ? new URL(result.origin).hostname : "";

  const largestPatterns = useMemo(
    () => (result ? result.groups.filter((group) => group.pattern !== "/").slice(0, MAX_ANALYSED_PATTERNS).map((group) => group.pattern) : []),
    [result],
  );

  const analysisState = useMemo<AnalysisState | null>(() => {
    if (!result || (!site && Object.keys(results).length === 0)) return null;
    const map: MapSummary = {
      origin: result.origin,
      host: new URL(result.origin).hostname,
      source: result.source,
      total: result.total,
      sitemaps: result.sitemaps,
      sitemapStats: result.sitemapStats ?? [],
      truncated: result.truncated,
      notes: result.notes,
      groups: result.groups.map((group) => ({
        pattern: group.pattern,
        count: group.count,
        share: group.share ?? 0,
        lastmodNewest: group.lastmodNewest ?? null,
        lastmodOldest: group.lastmodOldest ?? null,
        lastmodCoverage: group.lastmodCoverage ?? 0,
        placeholders: group.placeholders ?? [],
      })),
    };
    return {
      map,
      site,
      patterns: result.groups.map((group) => results[group.pattern]).filter((item): item is PatternResult => Boolean(item)),
      pagesPerPattern,
      generatedAt: new Date().toISOString(),
    };
  }, [result, site, results, pagesPerPattern]);

  const absoluteGroups = useMemo(
    () => (result ? result.groups.map((group) => ({ pattern: group.pattern, urls: group.urls.map((url) => toAbsolute(url, result.origin)) })) : []),
    [result],
  );
  const findings = useMemo(() => (analysisState ? findIssues(analysisState) : { issues: [], blocked: [] }), [analysisState]);
  const linkMap = useMemo(
    () => (analysisState ? buildLinkMap(analysisState.patterns, site?.homepage ?? null, analysisState.map.groups.map((group) => group.pattern)) : null),
    [analysisState, site],
  );
  const stack = useMemo(
    () => stackSummary([...(site ? [site.homepage] : []), ...Object.values(results).flatMap((item) => item.pages)]),
    [site, results],
  );
  const analysedPages = analysisState
    ? analysisState.patterns.reduce((sum, item) => sum + item.pages.length, 0) + (site ? 1 : 0)
    : 0;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!domain.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, identity: asBrowser ? "browser" : "bot" }),
      });
      let data: (Partial<MapResult> & { error?: string }) | null = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }
      if (!response.ok || !data || data.error || !data.groups) {
        const fallback =
          response.status === 504
            ? "The site took longer than a minute to map. Try again, or try a smaller site."
            : `The server returned an error (status ${response.status}). Try again in a minute.`;
        setError(data?.error ?? fallback);
        return;
      }
      const next = data as MapResult;
      setResult(next);
      setFilter("");
      setOpen(new Set(next.groups[0] ? [next.groups[0].pattern] : []));
      extractAbort.current?.abort();
      setContents(new Map());
      setJob(null);
      setJobId(null);
      setJobParam(null);
      analysisAbort.current?.abort();
      setSite(null);
      setSiteError(null);
      setResults({});
      setRun(null);
      setView("pages");
    } catch {
      setError("Couldn't reach the Sitemapper server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  /** Extracts the contents of every listed page not extracted yet. */
  async function extractContents() {
    if (!result || extracting || analysing) return;
    const listed = visibleGroups.flatMap((group) => group.urls.map((url) => toAbsolute(url, result.origin)));
    const pending = listed.filter((url) => !contentsRef.current.get(url)?.ok);
    const urls = pending.slice(0, MAX_EXTRACT_PAGES);
    const idle = { rendering: null, retrying: null, error: null, failed: 0 };
    if (urls.length === 0) {
      setJob({ ...idle, total: 0, done: 0, state: "done", skipped: 0 });
      return;
    }
    if (serverJobs) {
      await startServerJob(urls, pending.length - urls.length);
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    extractAbort.current = controller;
    setJob({ ...idle, total: urls.length, done: 0, state: "running", skipped: pending.length - urls.length });

    const identity = asBrowser ? "browser" : "bot";
    // When a site answers 429, every request waits until this time.
    let pauseUntil = 0;
    const latest = new Map<string, ExtractResult>();
    // robots.txt per origin, read once by the server and sent back with every later request.
    const robotsTxt: Record<string, string> = {};

    const post = async (chunk: string[], options: { render?: boolean; gentle?: boolean } = {}) => {
      const delay = pauseUntil - Date.now();
      if (delay > 0) await wait(delay, signal);
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: chunk, identity, robotsTxt, ...options }),
        signal,
      });
      let data: { pages?: ExtractResult[]; robotsTxt?: Record<string, string>; error?: string } | null = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }
      if (data?.robotsTxt) Object.assign(robotsTxt, data.robotsTxt);
      if (!response.ok || !data?.pages) {
        throw new ServerError(
          data?.error ??
            (response.status === 504
              ? "The site took too long to respond. Try again later."
              : `The server returned an error (status ${response.status}). Try again in a minute.`),
        );
      }
      const pages = data.pages;
      const limited = pages.filter((page) => !page.ok && page.rateLimited);
      if (limited.length > 0) {
        const asked = Math.max(0, ...limited.map((page) => (!page.ok && page.retryAfter) || 0)) * 1000;
        // Wait as long as the site asked, or 10 seconds when it didn't say.
        pauseUntil = Math.max(pauseUntil, Date.now() + Math.min(asked > 0 ? asked : 10_000, MAX_PAUSE_MS));
      }
      return pages;
    };
    const store = (pages: ExtractResult[]) => {
      for (const page of pages) latest.set(page.url, page);
      setContents((current) => {
        const next = new Map(current);
        for (const page of pages) next.set(page.url, page);
        return next;
      });
    };
    const retryable = () =>
      urls.filter((url) => {
        const page = latest.get(url);
        return page !== undefined && !page.ok && page.retryable;
      });

    try {
      await inPool(chunks(urls, EXTRACT_CHUNK), EXTRACT_WORKERS, async (chunk) => {
        store(await post(chunk));
        setJob((current) => current && { ...current, done: current.done + chunk.length });
      });

      // Rate limits, server errors and timeouts are usually temporary: try
      // those pages again, one at a time and with growing pauses.
      for (let round = 0; round < RETRY_DELAYS_MS.length; round++) {
        const again = retryable();
        if (again.length === 0) break;
        setJob((current) => current && { ...current, retrying: { round: round + 1, done: 0, total: again.length } });
        await wait(Math.max(RETRY_DELAYS_MS[round], pauseUntil - Date.now()), signal);
        await inPool(chunks(again, RETRY_CHUNK), 1, async (chunk) => {
          store(await post(chunk, { gentle: true }));
          setJob(
            (current) =>
              current && {
                ...current,
                retrying: current.retrying && { ...current.retrying, done: current.retrying.done + chunk.length },
              },
          );
        });
      }
      setJob((current) => current && { ...current, retrying: null });

      // Pages whose HTML is a JavaScript shell get a second read in a browser,
      // and so do blocked pages when requests are sent as a regular browser.
      const shells = urls.filter((url) => {
        const page = latest.get(url);
        if (!page) return false;
        return page.ok ? page.needsRender : identity === "browser" && page.blocked === true;
      });
      if (shells.length > 0) {
        setJob((current) => current && { ...current, rendering: { done: 0, total: shells.length } });
        await inPool(chunks(shells, RENDER_CHUNK), RENDER_WORKERS, async (chunk) => {
          let rendered: ExtractResult[];
          try {
            rendered = await post(chunk, { render: true });
          } catch (error) {
            if (!(error instanceof ServerError)) throw error;
            const message = error.message;
            rendered = chunk.map((url) => ({ url, ok: false as const, error: message }));
          }
          const merged = rendered.map((page) => {
            const before = latest.get(page.url);
            // Keep the HTML reading when the browser couldn't load the page.
            return page.ok || !before?.ok ? page : { ...before, renderError: page.error };
          });
          store(merged);
          setJob((current) =>
            current?.rendering
              ? { ...current, rendering: { ...current.rendering, done: current.rendering.done + chunk.length } }
              : current,
          );
        });
      }
      const failed = urls.filter((url) => !latest.get(url)?.ok).length;
      setJob((current) => current && { ...current, state: "done", rendering: null, failed });
    } catch (error) {
      const message = signal.aborted
        ? null
        : error instanceof ServerError
          ? error.message
          : "Couldn't reach the Sitemapper server. Check your connection and try again.";
      controller.abort();
      const failed = urls.filter((url) => latest.has(url) && !latest.get(url)?.ok).length;
      setJob(
        (current) =>
          current && {
            ...current,
            state: message ? "failed" : "stopped",
            error: message,
            rendering: null,
            retrying: null,
            failed,
          },
      );
    } finally {
      if (extractAbort.current === controller) extractAbort.current = null;
    }
  }

  /** Hands the reading to the server, which keeps going after this page closes. */
  async function startServerJob(urls: string[], skipped: number) {
    if (!result) return;
    const patternOf = new Map<string, string>();
    for (const group of visibleGroups) for (const url of group.urls) patternOf.set(toAbsolute(url, result.origin), group.pattern);
    const idle = { rendering: null, retrying: null, error: null, failed: 0 };
    setJob({ ...idle, total: urls.length, done: 0, state: "running", skipped });
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin: result.origin,
          items: urls.map((url) => [url, patternOf.get(url) ?? "/"]),
          identity: asBrowser ? "browser" : "bot",
          skipped,
        }),
      });
      const data = (await response.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!response.ok || !data?.id) {
        setJob({ ...idle, total: urls.length, done: 0, state: "failed", skipped, error: data?.error ?? `The server returned an error (status ${response.status}). Try again in a minute.` });
        return;
      }
      setJobId(data.id);
      setJobParam(data.id);
    } catch {
      setJob({ ...idle, total: urls.length, done: 0, state: "failed", skipped, error: "Couldn't reach the Sitemapper server. Check your connection and try again." });
    }
  }

  /** Site checks (once per map), then sample pages of each pattern, 2 patterns at a time. */
  async function runAnalysis(patternList: string[]) {
    if (!result || analysing || extracting) return;
    const controller = new AbortController();
    const { signal } = controller;
    analysisAbort.current = controller;
    const origin = result.origin;
    const siteHost = new URL(origin).hostname;
    const allPatterns = result.groups.map((group) => group.pattern).slice(0, 500);
    const plan = patternList
      .map((pattern) => {
        const group = result.groups.find((item) => item.pattern === pattern);
        const urls = group ? pickSamples(group.urls.map((url) => toAbsolute(url, origin)), pagesPerPattern, siteHost) : [];
        return { pattern, count: group?.count ?? 0, urls };
      })
      .filter((item) => item.urls.length > 0);
    let currentSite = siteRef.current;
    const total = plan.reduce((sum, item) => sum + item.urls.length, 0) + (currentSite ? 0 : 1);
    setRun({ state: "running", done: 0, total, active: [], errors: [] });

    const post = async <T,>(path: string, body: unknown): Promise<T> => {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      let data: (T & { error?: string }) | null = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }
      if (!response.ok || !data || data.error) {
        throw new ServerError(
          data?.error ??
            (response.status === 504
              ? "The request took longer than a minute. Try again with fewer pages per pattern."
              : `The server returned an error (status ${response.status}).`),
        );
      }
      return data;
    };

    try {
      if (!currentSite) {
        try {
          currentSite = await post<SiteReport>("/api/site", { origin, patterns: allPatterns, sampleUrl: plan[0]?.urls[0] ?? null });
          setSite(currentSite);
          setSiteError(null);
        } catch (error) {
          if (signal.aborted) throw error;
          setSiteError(error instanceof ServerError ? error.message : "Couldn't reach the Sitemapper server for the site checks.");
        }
        setRun((current) => current && { ...current, done: current.done + 1 });
      }
      const robotsTxt = currentSite?.robots.present && !currentSite.robots.truncated ? currentSite.robots.text : undefined;
      await inPool(plan, ANALYSE_WORKERS, async (item) => {
        setRun((current) => current && { ...current, active: [...current.active, item.pattern] });
        try {
          const data = await post<{ pages: PageAnalysis[]; trimmed?: string[] }>("/api/analyse", {
            origin,
            pattern: item.pattern,
            urls: item.urls,
            patterns: allPatterns,
            robotsTxt,
          });
          const patternResult: PatternResult = {
            pattern: item.pattern,
            count: item.count,
            pages: data.pages,
            aggregate: aggregatePattern(item.pattern, data.pages),
            trimmed: data.trimmed ?? [],
          };
          setResults((current) => ({ ...current, [item.pattern]: patternResult }));
        } catch (error) {
          if (signal.aborted) throw error;
          const message = error instanceof ServerError ? error.message : "Couldn't reach the Sitemapper server.";
          setRun((current) => current && { ...current, errors: [...current.errors, `${item.pattern}: ${message}`] });
        } finally {
          setRun(
            (current) =>
              current && {
                ...current,
                done: current.done + item.urls.length,
                active: current.active.filter((pattern) => pattern !== item.pattern),
              },
          );
        }
      });
      setRun((current) => current && { ...current, state: "done", active: [] });
    } catch {
      setRun((current) => current && { ...current, state: signal.aborted ? "stopped" : "failed", active: [] });
    } finally {
      if (analysisAbort.current === controller) analysisAbort.current = null;
    }
  }

  function stopAnalysis() {
    analysisAbort.current?.abort();
  }

  function stopExtracting() {
    extractAbort.current?.abort();
    if (jobId && job?.state === "running") {
      fetch(`/api/jobs/${encodeURIComponent(jobId)}/stop`, { method: "POST" }).catch(() => undefined);
      setJob((current) => current && { ...current, state: "stopped" });
    }
  }

  function toggle(pattern: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(pattern)) next.delete(pattern);
      else next.add(pattern);
      return next;
    });
  }

  /** Copies every listed page URL; true when the browser allowed it. */
  async function copyUrls(): Promise<boolean> {
    if (!result) return false;
    return copyText(visibleGroups.flatMap((group) => group.urls.map((url) => toAbsolute(url, result.origin))).join("\n"));
  }

  function handleDownload() {
    if (!result) return;
    const withContents = contents.size > 0;
    const rows = visibleGroups.flatMap((group) =>
      group.urls.map((url) => {
        const absolute = toAbsolute(url, result.origin);
        const row = [absolute, group.pattern];
        return withContents ? [...row, ...contentCsvCells(contents.get(absolute))] : row;
      }),
    );
    const header = withContents ? ["url", "pattern", ...CONTENT_CSV_HEADER] : ["url", "pattern"];
    downloadCsv(`${host}-pages.csv`, header, rows);
  }

  return (
    <div className="overflow-x-clip">
      <main className="mx-auto w-full max-w-3xl px-5 pt-16 pb-24 sm:pt-24">
        <header className="relative">
          <Contours />
          <div className="relative">
            <p className="font-display text-lg font-bold tracking-tight text-contour">Sitemapper</p>
            <h1 className="mt-6 max-w-[14ch] font-display text-5xl leading-[1.02] font-bold tracking-tight text-ink sm:text-6xl">
              See every page a site publishes
            </h1>
            <p className="mt-5 max-w-[52ch] text-base leading-relaxed text-muted sm:text-lg">
              Type a website&apos;s address. Sitemapper lists every page on it, grouped by type, so you can download
              the list or study how the pages are built.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="relative mt-10 flex flex-col gap-3 sm:flex-row">
            <label htmlFor="domain" className="sr-only">
              Domain
            </label>
            <input
              id="domain"
              name="domain"
              type="text"
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="go"
              placeholder="Enter a domain, like example.com"
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              className="h-14 w-full min-w-0 rounded-md sm:flex-1 border border-rule bg-sheet px-4 font-mono text-lg text-ink placeholder:font-sans placeholder:text-base placeholder:text-muted hover:border-contour/60"
            />
            <button
              type="submit"
              disabled={!domain.trim() || loading}
              className="h-14 shrink-0 rounded-md bg-ink px-7 text-base font-medium text-sheet transition-colors hover:bg-contour disabled:cursor-not-allowed disabled:bg-muted disabled:hover:bg-muted"
            >
              {loading ? "Mapping…" : "Map site"}
            </button>
          </form>

          <details className="relative mt-4 max-w-[52ch] text-sm">
            <summary className="cursor-pointer text-muted hover:text-contour">Advanced options</summary>
          <label className="mt-3 flex cursor-pointer items-start gap-3 text-sm text-ink">
            <input
              type="checkbox"
              checked={asBrowser}
              onChange={(event) => setAsBrowser(event.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-contour"
            />
            <span>
              Send requests as a regular browser
              <span className="mt-0.5 block text-muted">
                For sites that block tools. Uses a standard Chrome identity instead of SitemapperBot, and retries
                blocked pages in a real browser. Applies to mapping and Read every page, not to studying sample pages.
              </span>
            </span>
          </label>
          </details>

          {restoring && (
            <p role="status" className="relative mt-6 text-sm text-muted">
              Opening the job link.
            </p>
          )}

          {loading && (
            <div role="status" className="relative mt-6">
              <div className="h-[3px] w-full overflow-hidden rounded-full bg-contour-soft">
                <div className="h-full w-2/5 animate-survey rounded-full bg-contour" />
              </div>
              <p className="mt-3 text-sm text-muted">Reading sitemaps. Large sites can take up to a minute.</p>
            </div>
          )}

          {error && !loading && (
            <p role="alert" className="relative mt-6 max-w-[52ch] border-l-2 border-alert pl-4 text-ink">
              {error}
            </p>
          )}
        </header>

        {result && (
          <section aria-labelledby="results-summary" className="mt-14 border-t border-rule pt-10">
            <h2 id="results-summary" className="text-xl leading-snug text-ink sm:text-2xl">
              <span className="font-display text-5xl font-bold tracking-tight tabular-nums sm:text-6xl">
                {formatNumber(result.total)}
              </span>{" "}
              {result.total === 1 ? "page" : "pages"} on <span className="break-words">{host}</span>, in{" "}
              {plural(result.groups.length, "pattern")}.
            </h2>
            <p className="mt-3 max-w-[52ch] text-sm leading-relaxed text-muted">
              {result.restored
                ? "These are the pages read by the job in this link. Map the site again for the full list."
                : result.source === "sitemap"
                  ? `Found in ${plural(result.sitemaps.length, "sitemap")}.`
                  : "Found by following links."}{" "}
              A pattern is a group of pages that share one URL shape and usually one template, like /predictions/*.
              {result.notes.map((note) => (
                <span key={note}> {note}</span>
              ))}
            </p>

            <DownloadPanel
              host={host}
              state={analysisState}
              groupsWithUrls={absoluteGroups}
              pageCount={visibleTotal}
              filtered={isFiltering}
              hasContents={contents.size > 0}
              onDownloadPages={handleDownload}
              onCopyUrls={copyUrls}
            />

            <section aria-labelledby="study-heading" className="mt-12">
              <h2 id="study-heading" className="font-display text-2xl font-bold tracking-tight text-ink">
                Want more detail?
              </h2>
              <p className="mt-2 max-w-[52ch] text-sm text-muted">
                Optional. Pick one. The downloads above fill in as it runs.
              </p>
              <ul className="mt-4 divide-y divide-rule border-y border-rule">
                <li className="py-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-5">
                    <button
                      type="button"
                      onClick={() => runAnalysis(largestPatterns)}
                      disabled={analysing || extracting || largestPatterns.length === 0}
                      className="inline-flex h-11 w-full shrink-0 items-center justify-center rounded-md bg-ink px-4 text-sm font-medium whitespace-nowrap text-sheet transition-colors hover:bg-contour disabled:cursor-not-allowed disabled:bg-muted disabled:hover:bg-muted sm:w-56"
                    >
                      {analysing ? "Studying…" : "Study sample pages"}
                    </button>
                    <p className="text-sm leading-relaxed text-muted">
                      <span className="text-ink">Recommended.</span> Opens {pagesPerPattern}{" "}
                      {pagesPerPattern === 1 ? "page" : "pages"} from each of the{" "}
                      {largestPatterns.length === 1 ? "biggest pattern" : `${formatNumber(largestPatterns.length)} biggest patterns`}, plus the
                      homepage, and works out how the site is built: page templates, tech, links, ads and problems. Takes about a minute.
                    </p>
                  </div>
                  <div className="mt-3 flex items-center gap-3 sm:pl-[15.25rem]">
                    <span aria-hidden="true" className="text-sm text-muted">
                      Pages per pattern
                    </span>
                    <Segmented
                      legend="Pages per pattern"
                      options={PAGES_PER_PATTERN}
                      value={pagesPerPattern}
                      onChange={(value) => setPagesPerPattern(value)}
                      size="sm"
                    />
                  </div>
                {run && (
                  <div className="mt-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <p role="status" className="text-sm text-muted">
                        {run.state === "running"
                          ? `Analysed ${formatNumber(run.done)} of ${plural(run.total, "page")}.`
                          : run.state === "stopped"
                            ? `Stopped after ${plural(run.done, "page")}. Finished results are kept.`
                            : run.state === "failed"
                              ? `Stopped after ${plural(run.done, "page")}.`
                              : `Analysed ${plural(analysedPages, "page")}.`}
                      </p>
                      {run.state === "running" && (
                        <button type="button" onClick={stopAnalysis} className={secondaryButton.replace("flex-1 ", "")}>
                          Stop
                        </button>
                      )}
                    </div>
                    {run.state === "running" && (
                      <div className="mt-3 h-[3px] w-full overflow-hidden rounded-full bg-contour-soft">
                        <div
                          className="h-full rounded-full bg-contour"
                          style={{ width: `${run.total ? (run.done / run.total) * 100 : 0}%` }}
                        />
                      </div>
                    )}
                    {run.errors.length > 0 && (
                      <ul className="mt-3 space-y-1">
                        {run.errors.map((message) => (
                          <li key={message} className="border-l-2 border-alert pl-3 text-sm text-ink">
                            {message}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
                  {siteError && <p className="mt-3 border-l-2 border-alert pl-3 text-sm text-ink">Site checks failed: {siteError}</p>}
                </li>
                <li className="py-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-5">
                    <button
                      type="button"
                      onClick={extractContents}
                      disabled={visibleTotal === 0 || extracting || analysing}
                      className="inline-flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-md border border-rule px-4 text-sm font-medium whitespace-nowrap text-ink transition-colors hover:border-contour hover:text-contour disabled:cursor-not-allowed disabled:text-muted disabled:hover:border-rule sm:w-56"
                    >
                      <ExtractIcon />
                      {extracting ? "Reading…" : "Read every page"}
                    </button>
                    <p className="text-sm leading-relaxed text-muted">
                      Adds each page&apos;s title, headings and text to the page list download.
                      {serverJobs
                        ? " Runs on the server, so you can close this page and come back later."
                        : " Keep this page open until it finishes."}
                      {isFiltering && " Only the pages matching your filter are read."}
                    </p>
                  </div>
                  {job && <ExtractionStatus job={job} onStop={stopExtracting} />}
                  {jobId && <JobLink href={jobHref(jobId)} running={job?.state === "running"} />}
                </li>
              </ul>
            </section>

            <section aria-labelledby="results-heading" className="mt-12">
              <h2 id="results-heading" className="font-display text-2xl font-bold tracking-tight text-ink">
                Results
              </h2>
              <div className="mt-3">
                <Segmented
                  legend="Show results"
                  options={[
                    { value: "pages", label: "Pages" },
                    { value: "problems", label: analysisState ? `Problems (${findings.issues.length})` : "Problems" },
                    { value: "site", label: "Site" },
                    { value: "links", label: "Links" },
                  ]}
                  value={view}
                  onChange={setView}
                />
              </div>

              {view === "pages" && result.total > 0 && (
                <>
                  <p className="mt-4 max-w-[52ch] text-sm text-muted">
                    Pages grouped by URL pattern. Open a pattern to see its pages and, once studied, how it&apos;s built.
                  </p>
                  <label htmlFor="filter" className="sr-only">
                    Filter URLs
                  </label>
                  <input
                    id="filter"
                    type="search"
                    autoCapitalize="off"
                    autoCorrect="off"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="Filter URLs, like premier-league"
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    className="mt-4 h-11 w-full min-w-0 rounded-md border border-rule bg-sheet px-3 text-sm text-ink placeholder:text-muted hover:border-contour/60"
                  />
                  <div aria-live="polite" className="text-sm text-muted">
                    {isFiltering && (
                      <p className="mt-3">
                        {formatNumber(visibleTotal)} of {plural(result.total, "URL")}{" "}
                        {visibleTotal === 1 ? "matches" : "match"}. The page list download only includes these.
                      </p>
                    )}
                  </div>
                {visibleGroups.length > 0 && (
                  <ul className="mt-5 divide-y divide-rule rounded-md border border-rule">
                    {visibleGroups.map((group, index) => {
                      const isOpen = open.has(group.pattern);
                      const panelId = `group-panel-${index}`;
                      const patternResult = results[group.pattern];
                      const patternIssues = patternResult ? issuesForPattern(findings.issues, group.pattern) : [];
                      return (
                        <li key={group.pattern}>
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            aria-controls={panelId}
                            onClick={() => toggle(group.pattern)}
                            className="group flex w-full items-center gap-3 px-4 py-3.5 text-left text-ink first:rounded-t-md hover:text-contour"
                          >
                            <span className="text-muted group-hover:text-contour">
                              <ChevronIcon open={isOpen} />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-mono text-sm" title={group.pattern}>
                                {group.pattern}
                              </span>
                              {patternResult && (
                                <span className="mt-0.5 flex min-w-0 gap-2 text-[13px] text-muted">
                                  <span className="min-w-0 flex-1 truncate">
                                    {patternResult.aggregate.templates.title.template ?? "No shared title"}
                                  </span>
                                  {patternIssues.length > 0 && (
                                    <span className="shrink-0 text-alert">{plural(patternIssues.length, "issue")}</span>
                                  )}
                                </span>
                              )}
                              <span className="mt-2 block h-1 w-full rounded-full bg-contour-soft">
                                <span
                                  className="block h-full rounded-full bg-contour"
                                  style={{ width: `${largest ? Math.max((group.count / largest) * 100, 1) : 0}%` }}
                                />
                              </span>
                            </span>
                            <span className="shrink-0 pl-2 text-right font-display text-lg font-medium tabular-nums">
                              {formatNumber(group.count)}
                            </span>
                          </button>
                          {isOpen && (
                            <PatternPanel
                              id={panelId}
                              group={group}
                              origin={result.origin}
                              result={patternResult}
                              issues={patternIssues}
                              running={run?.active.includes(group.pattern) ?? false}
                              canAnalyse={!analysing && !extracting}
                              onAnalyse={() => runAnalysis([group.pattern])}
                            />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                  <ContentsSection groups={visibleGroups} contents={contents} origin={result.origin} />
                </>
              )}

              {view === "problems" &&
                (analysisState ? (
                  <IssuesSection issues={findings.issues} blocked={findings.blocked} />
                ) : (
                  <StudyFirst what="the problems Sitemapper finds" />
                ))}

              {view === "site" && (
                <>
                  {site && analysisState ? (
                    <SiteSection site={site} map={analysisState.map} stack={stack} />
                  ) : (
                    <StudyFirst what="the site's robots.txt, ads.txt, tech stack and hosting" />
                  )}
            {result.sitemaps.length > 0 && (
              <details className="mt-10 text-sm">
                <summary className="cursor-pointer text-muted hover:text-contour">
                  Sitemaps read ({formatNumber(result.sitemaps.length)})
                </summary>
                <ul className="mt-3 space-y-1">
                  {result.sitemaps.map((sitemap) => (
                    <li key={sitemap}>
                      <a
                        href={sitemap}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate font-mono text-[13px] text-ink hover:text-contour hover:underline"
                      >
                        {sitemap}
                      </a>
                    </li>
                  ))}
                </ul>
              </details>
            )}
                  {analysisState && <MethodLimits state={analysisState} blocked={findings.blocked} />}
                </>
              )}

              {view === "links" &&
                (analysisState && linkMap && analysisState.patterns.length > 0 ? (
                  <LinkMapSection linkMap={linkMap} />
                ) : (
                  <StudyFirst what="which page types link to which" />
                ))}
            </section>
          </section>
        )}
      </main>
    </div>
  );
}
