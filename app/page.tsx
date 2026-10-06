"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckIcon,
  ChevronIcon,
  copyText,
  CopyIcon,
  DownloadIcon,
  downloadCsv,
  downloadText,
  ExtractIcon,
  formatNumber,
  plural,
  toAbsolute,
  type Group,
} from "./ui";
import {
  CONTENT_CSV_HEADER,
  contentCsvCells,
  contentRecord,
  ExtractionStatus,
  JobLink,
  type ContentsMap,
  type ExtractionJob,
} from "./contents";
import type { ExtractResult, PageContents } from "@/lib/contents";
import type { JobStatus } from "@/lib/jobs";
import { spreadSample } from "@/lib/patterns";

type MapResult = {
  origin: string;
  source: "sitemap" | "crawl";
  sitemaps: string[];
  truncated: boolean;
  notes: string[];
  total: number;
  groups: Group[];
  /** Rebuilt from a job link: only the pages that job read. */
  restored?: boolean;
};

/** Most pages one run covers; running again continues with the rest. */
const MAX_EXTRACT_PAGES = 5_000;
const EXTRACT_CHUNK = 20;
/** Requests in flight at once; each reads 6 pages at a time. */
const EXTRACT_WORKERS = 4;
/** Pages that failed for temporary reasons get two more tries. */
const RETRY_DELAYS_MS = [3_000, 10_000];
/** After the site asks for fewer requests, retries go one small request at a time. */
const GENTLE_CHUNK = 5;
const RENDER_CHUNK = 6;
const RENDER_WORKERS = 2;
const MAX_PAUSE_MS = 60_000;
/** How often an open page checks on a job running on the server. */
const JOB_POLL_MS = 3_000;
const MAX_LISTED_URLS = 200;
/** How many pages to read from each URL group; "all" reads every page. */
const PER_GROUP_OPTIONS = [3, 5, 10, "all"] as const;
type PerGroup = (typeof PER_GROUP_OPTIONS)[number];

const primaryButton =
  "inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-ink px-5 text-base font-medium whitespace-nowrap text-sheet transition-colors hover:bg-contour disabled:cursor-not-allowed disabled:bg-muted disabled:hover:bg-muted sm:w-auto";
const outlineButton =
  "inline-flex h-12 w-full items-center justify-center gap-2 rounded-md border border-rule px-5 text-base font-medium whitespace-nowrap text-ink transition-colors hover:border-contour hover:text-contour disabled:cursor-not-allowed disabled:text-muted disabled:hover:border-rule sm:w-auto";
const linkButton =
  "inline-flex items-center gap-1.5 text-sm text-ink underline decoration-rule underline-offset-2 hover:text-contour hover:decoration-contour";

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
    .map(([pattern, urls]) => ({ pattern, count: urls.length, urls }))
    .sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern));
  return { origin, source: "sitemap", sitemaps: [], truncated: false, notes: [], total: items.length, groups, restored: true };
}

/** Shows a check mark on a button for a moment after it worked. */
function useFlash(): [string | null, (name: string) => void] {
  const [flashed, setFlashed] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return [
    flashed,
    (name) => {
      setFlashed(name);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setFlashed(null), 1800);
    },
  ];
}

const CONTOURS = [
  "M373.9 230.0C374.8 234.5 371.6 240.1 368.8 244.6C366.0 249.0 362.3 254.3 357.2 256.6C352.1 258.8 344.0 257.8 338.2 257.9C332.3 258.0 328.1 257.3 322.1 257.2C316.0 257.1 306.9 259.5 302.1 257.3C297.4 255.0 295.0 248.2 293.6 243.7C292.2 239.1 293.6 234.6 293.6 230.0C293.7 225.4 291.8 220.5 293.7 216.4C295.5 212.2 300.3 208.7 304.7 205.3C309.1 201.8 314.1 196.8 319.9 195.5C325.7 194.2 334.6 195.0 339.5 197.5C344.5 200.0 345.8 207.4 349.7 210.7C353.6 214.1 359.1 214.4 363.1 217.6C367.1 220.8 372.9 225.5 373.9 230.0Z",
  "M425.3 234.0C426.7 243.9 415.1 256.3 407.5 265.4C399.9 274.5 390.8 283.7 379.8 288.6C368.9 293.4 353.9 293.6 341.7 294.4C329.5 295.3 319.6 293.9 306.5 293.8C293.4 293.7 273.3 298.7 262.9 293.7C252.6 288.7 247.2 273.8 244.5 263.9C241.7 253.9 246.8 244.1 246.4 234.0C246.1 223.9 239.0 212.7 242.4 203.4C245.8 194.1 256.8 185.0 266.9 178.1C277.0 171.3 290.1 164.0 302.9 162.0C315.7 160.1 333.2 161.4 343.8 166.4C354.4 171.5 357.4 185.8 366.6 192.4C375.7 199.0 389.0 199.0 398.8 205.9C408.6 212.9 423.8 224.1 425.3 234.0Z",
  "M480.2 238.0C481.0 253.4 456.8 271.9 443.2 285.0C429.5 298.1 414.8 308.9 398.5 316.7C382.2 324.6 363.6 329.4 345.5 332.0C327.5 334.7 310.6 332.8 290.3 332.5C270.0 332.2 239.6 338.2 223.7 330.2C207.8 322.1 198.9 299.6 194.9 284.2C191.0 268.8 200.8 253.8 199.8 238.0C198.9 222.2 184.6 204.4 189.3 189.7C194.0 175.0 211.6 159.4 227.9 149.9C244.2 140.5 267.3 134.8 287.2 132.9C307.1 130.9 330.9 131.6 347.2 138.2C363.6 144.7 370.3 162.9 385.5 172.0C400.7 181.1 422.8 181.7 438.6 192.7C454.4 203.7 479.4 222.6 480.2 238.0Z",
  "M534.7 242.0C533.3 262.8 494.2 286.3 474.1 302.9C453.9 319.4 434.5 329.9 413.8 341.5C393.2 353.1 373.6 366.9 350.2 372.4C326.7 377.9 300.7 375.6 273.2 374.5C245.7 373.4 206.6 377.5 185.3 365.9C164.0 354.2 150.7 325.2 145.4 304.6C140.0 283.9 154.7 263.5 153.1 242.0C151.5 220.5 129.6 195.8 135.6 175.8C141.5 155.7 166.1 133.0 188.9 121.7C211.8 110.4 245.9 109.9 272.8 108.1C299.7 106.3 327.7 104.5 350.3 111.1C373.0 117.6 386.6 136.4 408.6 147.6C430.5 158.8 461.1 162.4 482.1 178.1C503.1 193.9 536.0 221.2 534.7 242.0Z",
  "M584.2 246.0C579.6 272.0 526.2 299.1 500.0 318.9C473.9 338.6 451.4 348.4 427.5 364.7C403.5 381.1 384.8 407.9 356.1 417.1C327.3 426.3 289.6 422.9 255.0 420.1C220.5 417.2 175.0 415.8 148.6 399.9C122.2 384.0 103.7 350.3 96.5 324.7C89.3 299.0 107.8 273.1 105.5 246.0C103.2 218.9 75.0 187.4 82.6 162.1C90.1 136.8 121.2 106.8 150.7 94.1C180.1 81.5 225.5 88.3 259.3 86.5C293.1 84.6 324.1 77.9 353.7 83.2C383.3 88.4 408.0 104.7 437.0 118.0C465.9 131.2 502.9 141.5 527.4 162.9C552.0 184.2 588.7 220.0 584.2 246.0Z",
  "M625.1 250.0C616.9 280.9 553.0 310.4 522.5 333.5C492.0 356.7 468.5 366.5 442.0 388.8C415.5 411.0 397.9 453.7 363.5 467.1C329.2 480.4 277.4 474.7 236.0 468.7C194.6 462.6 146.2 451.6 115.0 430.9C83.9 410.1 58.9 374.3 49.1 344.2C39.3 314.1 59.3 282.5 56.3 250.0C53.4 217.5 21.7 179.5 31.3 149.1C40.8 118.7 77.6 81.4 113.4 67.6C149.2 53.7 205.4 68.3 246.1 65.9C286.8 63.5 320.3 50.0 357.7 52.9C395.1 55.8 434.8 67.5 470.5 83.3C506.1 99.2 545.7 120.3 571.5 148.1C597.3 175.8 633.3 219.1 625.1 250.0Z",
  "M655.6 254.0C644.5 289.5 577.2 321.0 544.6 348.1C512.0 375.2 488.7 387.4 460.1 416.3C431.4 445.3 413.0 505.0 372.5 522.0C331.9 539.0 264.4 529.1 216.6 518.4C168.8 507.7 121.1 483.6 85.6 457.7C50.1 431.8 17.0 397.0 3.5 363.1C-10.0 329.1 8.0 291.7 4.4 254.0C0.9 216.3 -30.1 172.2 -18.0 136.9C-5.9 101.5 35.2 57.3 77.0 41.8C118.7 26.4 185.0 47.9 232.6 44.2C280.2 40.4 316.8 19.3 362.7 19.5C408.5 19.6 466.2 25.9 507.6 45.1C549.1 64.4 586.6 100.1 611.2 134.9C635.9 169.7 666.7 218.5 655.6 254.0Z",
];

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MapResult | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [contents, setContents] = useState<ContentsMap>(new Map());
  const contentsRef = useRef<ContentsMap>(contents);
  contentsRef.current = contents;
  const [job, setJob] = useState<ExtractionJob | null>(null);
  const extractAbort = useRef<AbortController | null>(null);
  const extracting = job?.state === "running";
  /** True when this server can read pages in the background, with the page closed. */
  const [serverJobs, setServerJobs] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [perGroup, setPerGroup] = useState<PerGroup>(10);
  const [flashed, flash] = useFlash();
  const [copyError, setCopyError] = useState(false);

  useEffect(() => {
    return () => extractAbort.current?.abort();
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
          setResult(restoredResult(data.origin, data.items));
          setDomain(new URL(data.origin).hostname);
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

  const host = result ? new URL(result.origin).hostname : "";
  const largest = result?.groups[0]?.count ?? 0;

  /** Every page as a full URL with its pattern, in list order. */
  const pages = useMemo(
    () =>
      result
        ? result.groups.flatMap((group) => group.urls.map((url) => ({ url: toAbsolute(url, result.origin), pattern: group.pattern })))
        : [],
    [result],
  );
  /** The pages Get page contents reads: a spread of up to `perGroup` from each group. */
  const targets = useMemo(() => {
    if (!result) return [];
    return result.groups.flatMap((group) =>
      spreadSample(group.urls, perGroup === "all" ? null : perGroup).map((url) => ({
        url: toAbsolute(url, result.origin),
        pattern: group.pattern,
      })),
    );
  }, [result, perGroup]);
  const read = useMemo(() => {
    const ok: { page: PageContents; pattern: string }[] = [];
    const failed: { url: string; pattern: string; error: string }[] = [];
    for (const { url, pattern } of pages) {
      const page = contents.get(url);
      if (!page) continue;
      if (page.ok) ok.push({ page, pattern });
      else failed.push({ url, pattern, error: page.error });
    }
    return { ok, failed };
  }, [pages, contents]);
  // While a run is going, pages it hasn't finished yet aren't counted as failed.
  const failedShown = extracting ? [] : read.failed;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!domain.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain }),
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
      setOpen(new Set());
      extractAbort.current?.abort();
      setContents(new Map());
      setJob(null);
      setJobId(null);
      setJobParam(null);
    } catch {
      setError("Couldn't reach the Sitemapper server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  /** Reads every page not read yet: on the server when it can, otherwise from this page. */
  async function extractContents() {
    if (!result || extracting) return;
    const pending = targets.filter((page) => !contentsRef.current.get(page.url)?.ok).map((page) => page.url);
    const urls = pending.slice(0, MAX_EXTRACT_PAGES);
    const skipped = pending.length - urls.length;
    const idle = { rendering: null, retrying: null, error: null, failed: 0 };
    if (urls.length === 0) {
      setJob({ ...idle, total: 0, done: 0, state: "done", skipped: 0 });
      return;
    }
    if (serverJobs) {
      await startServerJob(urls, skipped);
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    extractAbort.current = controller;
    setJob({ ...idle, total: urls.length, done: 0, state: "running", skipped });

    // When a site answers 429, every request waits until this time.
    let pauseUntil = 0;
    let rateLimited = false;
    const latest = new Map<string, ExtractResult>();
    // robots.txt per origin, read once by the server and sent back with every later request.
    const robotsTxt: Record<string, string> = {};

    const post = async (chunk: string[], options: { render?: boolean; gentle?: boolean } = {}) => {
      const delay = pauseUntil - Date.now();
      if (delay > 0) await wait(delay, signal);
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The server asks as SitemapperBot first and as a regular browser when refused.
        body: JSON.stringify({ urls: chunk, identity: options.render ? "browser" : "bot", robotsTxt, ...options }),
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
      const results = data.pages;
      const limited = results.filter((page) => !page.ok && page.rateLimited);
      if (limited.length > 0) {
        rateLimited = true;
        const asked = Math.max(0, ...limited.map((page) => (!page.ok && page.retryAfter) || 0)) * 1000;
        // Wait as long as the site asked, or 10 seconds when it didn't say.
        pauseUntil = Math.max(pauseUntil, Date.now() + Math.min(asked > 0 ? asked : 10_000, MAX_PAUSE_MS));
      }
      return results;
    };
    const store = (results: ExtractResult[]) => {
      for (const page of results) latest.set(page.url, page);
      setContents((current) => {
        const next = new Map(current);
        for (const page of results) next.set(page.url, page);
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

      // Server errors and timeouts are usually temporary: try those pages again.
      for (let round = 0; round < RETRY_DELAYS_MS.length; round++) {
        const again = retryable();
        if (again.length === 0) break;
        setJob((current) => current && { ...current, retrying: { round: round + 1, done: 0, total: again.length } });
        await wait(Math.max(RETRY_DELAYS_MS[round], pauseUntil - Date.now()), signal);
        const gentle = rateLimited;
        await inPool(chunks(again, gentle ? GENTLE_CHUNK : EXTRACT_CHUNK), gentle ? 1 : EXTRACT_WORKERS, async (chunk) => {
          store(await post(chunk, { gentle }));
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

      // Pages that build their content with JavaScript, and pages the site
      // refused, get another read in a real browser.
      const second = urls.filter((url) => {
        const page = latest.get(url);
        if (!page) return false;
        return page.ok ? page.needsRender : page.blocked === true;
      });
      if (second.length > 0) {
        setJob((current) => current && { ...current, rendering: { done: 0, total: second.length } });
        await inPool(chunks(second, RENDER_CHUNK), RENDER_WORKERS, async (chunk) => {
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
            // Keep the first reading when the browser couldn't do better.
            if (page.ok || !before) return page;
            return before.ok ? { ...before, renderError: page.error } : before;
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
    const patternOf = new Map(pages.map((page) => [page.url, page.pattern]));
    const idle = { rendering: null, retrying: null, error: null, failed: 0 };
    setJob({ ...idle, total: urls.length, done: 0, state: "running", skipped });
    const fail = (message: string) => setJob({ ...idle, total: urls.length, done: 0, state: "failed", skipped, error: message });
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin: result.origin, items: urls.map((url) => [url, patternOf.get(url) ?? "/"]), skipped }),
      });
      const data = (await response.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!response.ok || !data?.id) {
        fail(data?.error ?? `The server returned an error (status ${response.status}). Try again in a minute.`);
        return;
      }
      setJobId(data.id);
      setJobParam(data.id);
    } catch {
      fail("Couldn't reach the Sitemapper server. Check your connection and try again.");
    }
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

  function downloadContents() {
    downloadCsv(
      `${host}-pages-and-contents.csv`,
      ["url", "pattern", ...CONTENT_CSV_HEADER],
      read.ok.map(({ page, pattern }) => [page.url, pattern, ...contentCsvCells(page)]),
    );
  }

  function downloadJson() {
    const records = read.ok.map(({ page, pattern }) => contentRecord(page, pattern));
    downloadText(`${host}-pages-and-contents.json`, JSON.stringify({ site: result?.origin, pages: records }, null, 2), "application/json");
  }

  function downloadLinks() {
    downloadCsv(`${host}-pages.csv`, ["url", "pattern"], pages.map(({ url, pattern }) => [url, pattern]));
  }

  function downloadFailed() {
    downloadCsv(`${host}-pages-not-read.csv`, ["url", "pattern", "reason"], failedShown.map(({ url, pattern, error }) => [url, pattern, error]));
  }

  async function copyLinks() {
    const ok = await copyText(pages.map((page) => page.url).join("\n"));
    setCopyError(!ok);
    if (ok) flash("links");
  }

  const hasContents = read.ok.length > 0;

  return (
    <div className="overflow-x-clip">
      <main className="mx-auto w-full max-w-3xl px-5 pt-16 pb-24 sm:pt-24">
        <header className="relative">
          <Contours />
          <div className="relative">
            <p className="font-display text-lg font-bold tracking-tight text-contour">Sitemapper</p>
            <h1 className="mt-6 max-w-[14ch] font-display text-5xl leading-[1.02] font-bold tracking-tight text-ink sm:text-6xl">
              Every page of a site, and what&apos;s on it
            </h1>
            <p className="mt-5 max-w-[52ch] text-base leading-relaxed text-muted sm:text-lg">
              Type a website&apos;s address. Sitemapper lists every page on it, reads each one, and gives you a
              spreadsheet of the pages and their contents.
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
              className="h-14 w-full min-w-0 rounded-md border border-rule bg-sheet px-4 font-mono text-lg text-ink placeholder:font-sans placeholder:text-base placeholder:text-muted hover:border-contour/60 sm:flex-1"
            />
            <button
              type="submit"
              disabled={!domain.trim() || loading}
              className="h-14 shrink-0 rounded-md bg-ink px-7 text-base font-medium text-sheet transition-colors hover:bg-contour disabled:cursor-not-allowed disabled:bg-muted disabled:hover:bg-muted"
            >
              {loading ? "Finding pages…" : "Find pages"}
            </button>
          </form>

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
              {result.total === 1 ? "page" : "pages"} on <span className="break-words">{host}</span>
            </h2>
            <p className="mt-3 max-w-[52ch] text-sm leading-relaxed text-muted">
              {result.restored
                ? "These are the pages in this job link. Find pages again for the site's full list."
                : result.source === "sitemap"
                  ? `Found in ${plural(result.sitemaps.length, "sitemap")}.`
                  : "Found by following links."}
              {result.notes.map((note) => (
                <span key={note}> {note}</span>
              ))}
            </p>

            <section aria-labelledby="contents-heading" className="mt-10">
              <h2 id="contents-heading" className="font-display text-2xl font-bold tracking-tight text-ink">
                1. Get page contents
              </h2>
              <p className="mt-2 max-w-[52ch] text-sm leading-relaxed text-muted">
                Reads the title, description, headings and text of{" "}
                {perGroup === "all" ? "every page" : `up to ${perGroup} pages from each group, spread from first to last`}
                {" "}({plural(targets.length, "page")} in all). Pages that block tools or need JavaScript are opened in a real browser.{" "}
                {serverJobs
                  ? "It runs on the server, so you can close this page and come back later."
                  : "Keep this page open until it finishes."}
              </p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                <label className="flex items-center gap-3 text-sm text-ink">
                  Pages from each group
                  <select
                    value={String(perGroup)}
                    onChange={(event) => {
                      const value = event.target.value;
                      setPerGroup(value === "all" ? "all" : (Number(value) as PerGroup));
                    }}
                    disabled={extracting}
                    className="h-12 rounded-md border border-rule bg-sheet px-3 text-base text-ink hover:border-contour/60 disabled:text-muted"
                  >
                    {PER_GROUP_OPTIONS.map((option) => (
                      <option key={option} value={String(option)}>
                        {option === "all" ? "All" : option}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={extractContents} disabled={targets.length === 0 || extracting} className={primaryButton}>
                  <ExtractIcon />
                  {extracting ? "Reading pages…" : "Get page contents"}
                </button>
              </div>
              {job && <ExtractionStatus job={job} onStop={stopExtracting} />}
              {jobId && <JobLink href={jobHref(jobId)} running={job?.state === "running"} />}
            </section>

            <section aria-labelledby="download-heading" className="mt-12">
              <h2 id="download-heading" className="font-display text-2xl font-bold tracking-tight text-ink">
                2. Download
              </h2>
              <p className="mt-2 max-w-[52ch] text-sm leading-relaxed text-muted">
                {hasContents
                  ? `${plural(read.ok.length, "page")} with their contents. Pages that couldn't be read are left out.`
                  : "Get page contents first. The spreadsheet then has one row per page with its title, headings and text."}
              </p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <button type="button" onClick={downloadContents} disabled={!hasContents} className={primaryButton}>
                  <DownloadIcon />
                  Spreadsheet (CSV)
                </button>
                <button type="button" onClick={downloadJson} disabled={!hasContents} className={outlineButton}>
                  <DownloadIcon />
                  JSON
                </button>
              </div>
              <div className="mt-4 flex flex-col items-start gap-2">
                <button type="button" onClick={downloadLinks} disabled={pages.length === 0} className={linkButton}>
                  <DownloadIcon />
                  Just the page links ({formatNumber(pages.length)})
                </button>
                <button type="button" onClick={copyLinks} disabled={pages.length === 0} className={linkButton}>
                  {flashed === "links" ? <CheckIcon /> : <CopyIcon />}
                  <span aria-live="polite">{flashed === "links" ? "Copied" : "Copy the page links"}</span>
                </button>
                {failedShown.length > 0 && (
                  <button type="button" onClick={downloadFailed} className={linkButton}>
                    <DownloadIcon />
                    The {plural(failedShown.length, "page")} that couldn&apos;t be read, and why
                  </button>
                )}
              </div>
              {copyError && (
                <p className="mt-3 border-l-2 border-alert pl-3 text-sm text-ink">This browser blocked copying. Use the download instead.</p>
              )}
            </section>

            {result.groups.length > 0 && (
              <section aria-labelledby="pages-heading" className="mt-12">
                <h2 id="pages-heading" className="font-display text-2xl font-bold tracking-tight text-ink">
                  Pages
                </h2>
                <p className="mt-2 max-w-[52ch] text-sm leading-relaxed text-muted">
                  Grouped by URL shape, like /blog/*. Open a group to see its pages.
                </p>
                <ul className="mt-4 divide-y divide-rule rounded-md border border-rule">
                  {result.groups.map((group, index) => {
                    const isOpen = open.has(group.pattern);
                    const panelId = `group-panel-${index}`;
                    const listed = group.urls.slice(0, MAX_LISTED_URLS);
                    return (
                      <li key={group.pattern}>
                        <button
                          type="button"
                          aria-expanded={isOpen}
                          aria-controls={panelId}
                          onClick={() => toggle(group.pattern)}
                          className="group flex w-full items-center gap-3 px-4 py-3.5 text-left text-ink hover:text-contour"
                        >
                          <span className="text-muted group-hover:text-contour">
                            <ChevronIcon open={isOpen} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-mono text-sm" title={group.pattern}>
                              {group.pattern}
                            </span>
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
                          <div id={panelId} className="border-t border-rule px-4 py-3">
                            <ul className="space-y-1">
                              {listed.map((url) => {
                                const absolute = toAbsolute(url, result.origin);
                                const page = contents.get(absolute);
                                return (
                                  <li key={url} className="min-w-0">
                                    <a
                                      href={absolute}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="block truncate font-mono text-[13px] text-ink hover:text-contour hover:underline"
                                    >
                                      {url}
                                    </a>
                                    {page && (
                                      <span className={`block truncate text-[13px] ${page.ok ? "text-muted" : "text-alert"}`}>
                                        {page.ok ? page.title || "No title" : page.error}
                                      </span>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                            {group.urls.length > listed.length && (
                              <p className="mt-3 text-sm text-muted">
                                Showing {formatNumber(listed.length)} of {formatNumber(group.urls.length)}. The downloads have them all.
                              </p>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
