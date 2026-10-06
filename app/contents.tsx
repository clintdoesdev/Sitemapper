"use client";

import { useState } from "react";
import type { ExtractResult, PageContents } from "@/lib/contents";
import { CheckIcon, copyText, CopyIcon, formatNumber, plural, secondaryButton } from "./ui";

/** Progress of the current (or last) run of Get page contents. */
export type ExtractionJob = {
  total: number;
  done: number;
  /** Second pass that loads pages in a real browser. */
  rendering: { done: number; total: number } | null;
  /** A second try for pages that failed for temporary reasons. */
  retrying: { round: number; done: number; total: number } | null;
  /** Pages in this run that couldn't be read in the end. */
  failed: number;
  state: "running" | "done" | "stopped" | "failed";
  error: string | null;
  /** Pages left out because of the per-run limit. */
  skipped: number;
};

export type ContentsMap = ReadonlyMap<string, ExtractResult>;

/** Columns added to the CSV export for pages whose contents were extracted. */
export const CONTENT_CSV_HEADER = [
  "status",
  "title",
  "description",
  "h1",
  "canonical",
  "robots",
  "word_count",
  "internal_links",
  "external_links",
  "schema_types",
  "headings",
  "read_from",
  "text",
];

export function contentCsvCells(page: ExtractResult | undefined): string[] {
  if (!page) return CONTENT_CSV_HEADER.map(() => "");
  if (!page.ok) return [page.error, ...CONTENT_CSV_HEADER.slice(1).map(() => "")];
  return [
    String(page.status),
    page.title,
    page.description,
    page.h1,
    page.canonical,
    page.robots,
    String(page.wordCount),
    String(page.internalLinks),
    String(page.externalLinks),
    page.schemaTypes.join("; "),
    page.headings.map((heading) => `H${heading.level}: ${heading.text}`).join(" | "),
    page.rendered ? "browser" : "html",
    page.text,
  ];
}

/** One page and its contents, for the JSON download. */
export function contentRecord(page: PageContents, pattern: string) {
  return {
    url: page.url,
    pattern,
    status: page.status,
    finalUrl: page.finalUrl,
    lang: page.lang,
    title: page.title,
    description: page.description,
    h1: page.h1,
    canonical: page.canonical,
    robots: page.robots,
    wordCount: page.wordCount,
    internalLinks: page.internalLinks,
    externalLinks: page.externalLinks,
    schemaTypes: page.schemaTypes,
    headings: page.headings,
    readFrom: page.rendered ? "browser" : "html",
    text: page.text,
    textTruncated: page.textTruncated,
  };
}

export function ExtractionStatus({ job, onStop }: { job: ExtractionJob; onStop: () => void }) {
  const running = job.state === "running";
  const phase = job.rendering ?? job.retrying;
  const progress = phase ? phase.done / Math.max(phase.total, 1) : job.done / Math.max(job.total, 1);
  const read = job.done - job.failed;
  return (
    <div className="mt-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted" role="status">
          {running && job.rendering
            ? `Opening ${formatNumber(job.rendering.done)} of ${plural(job.rendering.total, "page")} in a real browser, because they block tools or build their content with JavaScript.`
            : running && job.retrying
              ? `Trying ${formatNumber(job.retrying.done)} of ${plural(job.retrying.total, "page")} again that failed the first time.`
              : running
                ? `Read ${formatNumber(job.done)} of ${plural(job.total, "page")}.`
                : job.state === "stopped"
                  ? `Stopped after ${plural(job.done, "page")}. Press Get page contents again to continue where it stopped.`
                  : job.state === "failed"
                    ? `Stopped after ${plural(job.done, "page")}.`
                    : `Done. Read ${plural(read, "page")}.`}
          {!running &&
            job.state === "done" &&
            job.failed > 0 &&
            ` ${formatNumber(job.failed)} couldn't be read and are left out of the download.`}
          {job.skipped > 0 &&
            ` ${formatNumber(job.skipped)} more ${job.skipped === 1 ? "page was" : "pages were"} left for later, because one run covers ${formatNumber(job.total)} pages. Press Get page contents again to continue.`}
        </p>
        {running && (
          <button type="button" onClick={onStop} className={secondaryButton.replace("flex-1 ", "")}>
            Stop
          </button>
        )}
      </div>
      {running && (
        <div className="mt-3 h-[3px] w-full overflow-hidden rounded-full bg-contour-soft">
          <div className="h-full rounded-full bg-contour" style={{ width: `${progress * 100}%` }} />
        </div>
      )}
      {job.error && (
        <p role="alert" className="mt-3 max-w-[52ch] border-l-2 border-alert pl-4 text-ink">
          {job.error}
        </p>
      )}
    </div>
  );
}

/** The link to a job running on the server, so it can be checked from anywhere. */
export function JobLink({ href, running }: { href: string; running: boolean }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  async function copy() {
    const ok = await copyText(href);
    setCopied(ok);
    if (ok) setTimeout(() => setCopied(null), 1800);
  }
  return (
    <div className="mt-4 border-l-2 border-contour pl-4 text-sm leading-relaxed text-muted">
      <p>
        <span className="text-ink">{running ? "This runs on the server." : "Saved on the server for 7 days."}</span>{" "}
        {running
          ? "You can close this page or switch off your phone. Open this link later to see how far it got and download the pages and their contents:"
          : "Open this link on any device to download the pages and their contents again:"}
      </p>
      <p className="mt-1 break-all font-mono text-[13px] text-ink">{href}</p>
      <button
        type="button"
        onClick={copy}
        className="mt-2 inline-flex items-center gap-1.5 text-sm text-ink underline decoration-rule underline-offset-2 hover:text-contour hover:decoration-contour"
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
        <span aria-live="polite">{copied ? "Copied" : copied === false ? "Copying was blocked; copy the link above by hand" : "Copy link"}</span>
      </button>
    </div>
  );
}
