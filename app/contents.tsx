"use client";

import { useState } from "react";
import type { ExtractResult, PageContents } from "@/lib/contents";
import { textTemplate } from "@/lib/patterns";
import { CheckIcon, copyText, CopyIcon, formatNumber, plural, secondaryButton, toAbsolute, type Group } from "./ui";

/** Progress of the current (or last) extraction. */
export type ExtractionJob = {
  total: number;
  done: number;
  /** Second pass that runs JavaScript pages in a browser. */
  rendering: { done: number; total: number } | null;
  /** Slower passes over pages that failed for temporary reasons. */
  retrying: { round: number; done: number; total: number } | null;
  /** Pages in this run that couldn't be read in the end. */
  failed: number;
  state: "running" | "done" | "stopped" | "failed";
  error: string | null;
  /** Matching pages left out because of the per-run limit. */
  skipped: number;
};

export type ContentsMap = ReadonlyMap<string, ExtractResult>;

const MAX_COMMON_HEADINGS = 15;
const MAX_LISTED_PAGES = 200;

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
    page.rendered ? "javascript" : "html",
    page.text,
  ];
}

function displayPath(url: string, origin: string): string {
  return url.startsWith(`${origin}/`) ? url.slice(origin.length) : url;
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

type Summary = {
  read: PageContents[];
  failed: number;
  rendered: number;
  titleTemplate: string | null;
  h1Template: string | null;
  descriptionTemplate: string | null;
  averageWords: number;
  minWords: number;
  maxWords: number;
  schemaTypes: { type: string; pages: number }[];
  commonHeadings: { text: string; level: number; pages: number }[];
};

function summarise(pages: ExtractResult[]): Summary {
  const read = pages.filter((page): page is PageContents => page.ok);
  const words = read.map((page) => page.wordCount);

  const schemaCounts = new Map<string, number>();
  for (const page of read) {
    for (const type of new Set(page.schemaTypes)) schemaCounts.set(type, (schemaCounts.get(type) ?? 0) + 1);
  }

  // Headings that repeat across pages are the template's fixed sections.
  const headingCounts = new Map<string, { text: string; level: number; pages: number }>();
  for (const page of read) {
    const seen = new Set<string>();
    for (const heading of page.headings) {
      if (heading.level === 1) continue;
      const key = `${heading.level}:${normalise(heading.text)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const entry = headingCounts.get(key);
      if (entry) entry.pages++;
      else headingCounts.set(key, { text: heading.text, level: heading.level, pages: 1 });
    }
  }
  const threshold = Math.max(2, Math.ceil(read.length / 2));
  // Templates are found from a sample; comparing thousands of titles adds nothing.
  const sample = read.length > 300 ? read.filter((_, index) => index % Math.ceil(read.length / 300) === 0) : read;

  return {
    read,
    failed: pages.length - read.length,
    rendered: read.filter((page) => page.rendered).length,
    titleTemplate: textTemplate(sample.map((page) => page.title)),
    h1Template: textTemplate(sample.map((page) => page.h1)),
    descriptionTemplate: textTemplate(sample.map((page) => page.description)),
    averageWords: words.length ? Math.round(words.reduce((sum, n) => sum + n, 0) / words.length) : 0,
    minWords: words.reduce((min, n) => Math.min(min, n), words.length ? Infinity : 0),
    maxWords: words.reduce((max, n) => Math.max(max, n), 0),
    schemaTypes: [...schemaCounts.entries()]
      .map(([type, count]) => ({ type, pages: count }))
      .sort((a, b) => b.pages - a.pages || a.type.localeCompare(b.type)),
    commonHeadings: [...headingCounts.values()]
      .filter((heading) => heading.pages >= threshold)
      .sort((a, b) => b.pages - a.pages)
      .slice(0, MAX_COMMON_HEADINGS),
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2.5 sm:grid sm:grid-cols-[9rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-0.5 min-w-0 text-sm break-words text-ink sm:mt-0">{children}</dd>
    </div>
  );
}

function Template({ value }: { value: string | null }) {
  if (!value) return <span className="text-muted">No shared wording</span>;
  return <span className="font-mono text-[13px]">{value}</span>;
}

function PageDetails({ page, origin }: { page: ExtractResult; origin: string }) {
  const path = displayPath(page.url, origin);
  if (!page.ok) {
    return (
      <div className="px-4 py-3">
        <p className="truncate font-mono text-[13px] text-ink">{path}</p>
        <p className="mt-1 border-l-2 border-alert pl-3 text-sm text-ink">{page.error}</p>
      </div>
    );
  }
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-start gap-3 px-4 py-3 hover:text-contour [&::-webkit-details-marker]:hidden">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="mt-0.5 size-4 shrink-0 text-muted transition-transform duration-150 group-open:rotate-90"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-mono text-[13px]">{path}</span>
          <span className="mt-0.5 block truncate text-sm text-muted">{page.title || "No title"}</span>
        </span>
        <span className="shrink-0 pl-2 text-right text-sm text-muted tabular-nums">
          {plural(page.wordCount, "word")}
          {page.rendered && <span className="block text-xs">JavaScript run</span>}
        </span>
      </summary>
      <div className="border-t border-rule bg-sheet px-4 py-2">
        <dl className="divide-y divide-rule">
          <Field label="Title">{page.title || <span className="text-muted">None</span>}</Field>
          <Field label="Description">{page.description || <span className="text-muted">None</span>}</Field>
          <Field label="H1">{page.h1 || <span className="text-muted">None</span>}</Field>
          {page.canonical && (
            <Field label="Canonical">
              <span className="font-mono text-[13px]">{displayPath(page.canonical, origin)}</span>
            </Field>
          )}
          {page.robots && <Field label="Robots meta">{page.robots}</Field>}
          {page.schemaTypes.length > 0 && <Field label="Schema types">{page.schemaTypes.join(", ")}</Field>}
          <Field label="Read from">
            {page.rendered
              ? "The page after its JavaScript ran in a browser"
              : page.renderError
                ? `The raw HTML. Running its JavaScript failed: ${page.renderError}`
                : "The raw HTML"}
          </Field>
          <Field label="Links">
            {formatNumber(page.internalLinks)} internal, {formatNumber(page.externalLinks)} external
          </Field>
          {page.headings.length > 0 && (
            <Field label="Headings">
              <ul className="space-y-1">
                {page.headings.map((heading, index) => (
                  <li
                    key={index}
                    style={{ paddingLeft: `${(heading.level - 1) * 0.75}rem` }}
                    className={heading.level <= 2 ? "text-ink" : "text-muted"}
                  >
                    <span className="mr-2 font-mono text-[11px] text-muted">H{heading.level}</span>
                    {heading.text}
                  </li>
                ))}
              </ul>
            </Field>
          )}
          <Field label="Text">
            {page.text ? (
              <>
                <div className="max-h-72 overflow-y-auto rounded-md border border-rule bg-paper p-3 text-sm leading-relaxed whitespace-pre-wrap">
                  {page.text}
                </div>
                {page.textTruncated && (
                  <p className="mt-2 text-sm text-muted">Cut at 32,000 characters, the most a spreadsheet cell can hold. The CSV has the same text.</p>
                )}
              </>
            ) : (
              <span className="text-muted">
                {page.rendered
                  ? "No readable text, even after running its JavaScript."
                  : "No readable text in the HTML."}
              </span>
            )}
          </Field>
        </dl>
      </div>
    </details>
  );
}

/** Progress line, bar and Stop button for the current extraction. */
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
            ? `Running JavaScript on ${formatNumber(job.rendering.done)} of ${plural(job.rendering.total, "page")} that build their content in the browser.`
            : running && job.retrying
              ? `Trying ${plural(job.retrying.total, "page")} again more slowly, because the site rate-limited or failed to answer (round ${job.retrying.round} of 3, ${formatNumber(job.retrying.done)} done).`
              : running
                ? `Read ${formatNumber(job.done)} of ${plural(job.total, "page")}.`
                : job.state === "stopped"
                  ? `Stopped after ${plural(job.done, "page")}. Press Read every page again to continue where it stopped.`
                  : job.state === "failed"
                    ? `Stopped after ${plural(job.done, "page")}.`
                    : `Read ${plural(read, "page")}. Download page list now includes them.`}
          {!running &&
            job.state === "done" &&
            job.failed > 0 &&
            ` ${formatNumber(job.failed)} couldn't be read; the status column in the page list says why. Press Read every page again to retry them.`}
          {job.skipped > 0 &&
            ` ${formatNumber(job.skipped)} more matching ${job.skipped === 1 ? "page was" : "pages were"} left out, because one run covers ${formatNumber(job.total)} pages. Run it again to continue.`}
        </p>
        {running && (
          <button type="button" onClick={onStop} className={secondaryButton.replace("flex-1 ", "")}>
            Stop extracting
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
          ? "You can close this page or switch off your phone. Open this link later to see how far it got and download the page list:"
          : "Open this link on any device to download the page list again:"}
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

function PatternContents({
  pattern,
  pages,
  groupSize,
  origin,
}: {
  pattern: string;
  pages: ExtractResult[];
  groupSize: number;
  origin: string;
}) {
  const summary = summarise(pages);
  const listed = pages.slice(0, MAX_LISTED_PAGES);
  return (
    <div className="border-t border-rule pt-8 first:border-t-0 first:pt-0">
      <h3 className="truncate font-mono text-base text-ink" title={pattern}>
        {pattern}
      </h3>
      <p className="mt-1 text-sm text-muted">
        Read {formatNumber(summary.read.length)} of {plural(groupSize, "page")}.
        {summary.failed > 0 && ` ${formatNumber(summary.failed)} couldn't be read.`}
        {summary.rendered > 0 &&
          ` ${summary.rendered === 1 ? "1 was" : `${formatNumber(summary.rendered)} were`} read after running JavaScript.`}
      </p>

      {summary.read.length > 0 && (
        <dl className="mt-5 divide-y divide-rule border-y border-rule">
          <Field label="Title template">
            <Template value={summary.titleTemplate} />
          </Field>
          <Field label="H1 template">
            <Template value={summary.h1Template} />
          </Field>
          <Field label="Description template">
            <Template value={summary.descriptionTemplate} />
          </Field>
          <Field label="Length">
            {formatNumber(summary.averageWords)} words on average, {formatNumber(summary.minWords)} to{" "}
            {formatNumber(summary.maxWords)}
          </Field>
          {summary.schemaTypes.length > 0 && (
            <Field label="Schema types">
              <ul className="space-y-0.5">
                {summary.schemaTypes.map((schema) => (
                  <li key={schema.type}>
                    {schema.type} <span className="text-muted">on {plural(schema.pages, "page")}</span>
                  </li>
                ))}
              </ul>
            </Field>
          )}
          {summary.commonHeadings.length > 0 && (
            <Field label="Shared headings">
              <ul className="space-y-0.5">
                {summary.commonHeadings.map((heading) => (
                  <li key={`${heading.level}:${heading.text}`}>
                    <span className="mr-2 font-mono text-[11px] text-muted">H{heading.level}</span>
                    {heading.text}{" "}
                    <span className="text-muted">
                      on {formatNumber(heading.pages)} of {formatNumber(summary.read.length)}
                    </span>
                  </li>
                ))}
              </ul>
            </Field>
          )}
        </dl>
      )}

      <details className="mt-5">
        <summary className="cursor-pointer text-sm text-muted hover:text-contour">
          Pages ({formatNumber(pages.length)})
        </summary>
        <ul className="mt-3 divide-y divide-rule rounded-md border border-rule">
          {listed.map((page) => (
            <li key={page.url}>
              <PageDetails page={page} origin={origin} />
            </li>
          ))}
        </ul>
        {pages.length > listed.length && (
          <p className="mt-3 text-sm text-muted">
            Showing {formatNumber(listed.length)} of {formatNumber(pages.length)}. Download the CSV for every page.
          </p>
        )}
      </details>
    </div>
  );
}

/** Extracted contents, summarised per URL pattern. */
export function ContentsSection({
  groups,
  contents,
  origin,
}: {
  groups: Group[];
  contents: ContentsMap;
  origin: string;
}) {
  const sections = groups
    .map((group) => ({
      group,
      pages: group.urls
        .map((url) => contents.get(toAbsolute(url, origin)))
        .filter((page): page is ExtractResult => page !== undefined),
    }))
    .filter((section) => section.pages.length > 0);
  if (sections.length === 0) return null;

  return (
    <section aria-labelledby="contents-heading" className="mt-14 border-t border-rule pt-10">
      <h2 id="contents-heading" className="font-display text-3xl font-bold tracking-tight text-ink">
        Page contents
      </h2>
      <p className="mt-2 max-w-[52ch] text-sm leading-relaxed text-muted">
        Templates show the wording the pages in each pattern share, with {"{…}"} where it changes. Open a page to
        see its headings and text.
      </p>
      <div className="mt-8 space-y-10">
        {sections.map(({ group, pages }) => (
          <PatternContents
            key={group.pattern}
            pattern={group.pattern}
            pages={pages}
            groupSize={group.count}
            origin={origin}
          />
        ))}
      </div>
    </section>
  );
}
