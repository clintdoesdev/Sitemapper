"use client";

import type { ExtractResult, PageContents } from "@/lib/extract";
import { textTemplate } from "@/lib/patterns";
import { DownloadIcon, downloadCsv, formatNumber, plural, secondaryButton } from "./ui";

export type ExtractionRun = {
  id: number;
  pattern: string;
  urls: string[];
  pages: ExtractResult[];
  state: "running" | "done" | "stopped" | "failed";
  error: string | null;
  /** Progress of the second pass that runs JavaScript pages in a browser. */
  rendering: { done: number; total: number } | null;
};

const MAX_COMMON_HEADINGS = 15;

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

function summarise(run: ExtractionRun): Summary {
  const read = run.pages.filter((page): page is PageContents => page.ok);
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

  return {
    read,
    failed: run.pages.length - read.length,
    rendered: read.filter((page) => page.rendered).length,
    titleTemplate: textTemplate(read.map((page) => page.title)),
    h1Template: textTemplate(read.map((page) => page.h1)),
    descriptionTemplate: textTemplate(read.map((page) => page.description)),
    averageWords: words.length ? Math.round(words.reduce((sum, n) => sum + n, 0) / words.length) : 0,
    minWords: words.length ? Math.min(...words) : 0,
    maxWords: words.length ? Math.max(...words) : 0,
    schemaTypes: [...schemaCounts.entries()]
      .map(([type, pages]) => ({ type, pages }))
      .sort((a, b) => b.pages - a.pages || a.type.localeCompare(b.type)),
    commonHeadings: [...headingCounts.values()]
      .filter((heading) => heading.pages >= threshold)
      .sort((a, b) => b.pages - a.pages)
      .slice(0, MAX_COMMON_HEADINGS),
  };
}

function downloadContents(run: ExtractionRun, host: string) {
  const header = [
    "url",
    "pattern",
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
  const rows = run.pages.map((page) =>
    page.ok
      ? [
          page.url,
          run.pattern,
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
        ]
      : [page.url, run.pattern, page.error, "", "", "", "", "", "", "", "", "", "", "", ""],
  );
  const slug = run.pattern.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home";
  downloadCsv(`${host}-${slug}-contents.csv`, header, rows);
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
                  <p className="mt-2 text-sm text-muted">Cut at 20,000 characters. The CSV has the same text.</p>
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

export function ExtractionRunView({
  run,
  origin,
  host,
  onStop,
}: {
  run: ExtractionRun;
  origin: string;
  host: string;
  onStop: () => void;
}) {
  const summary = summarise(run);
  const done = run.pages.length;
  const total = run.urls.length;

  return (
    <div id={`contents-${run.id}`} className="scroll-mt-6 border-t border-rule pt-8 first:border-t-0 first:pt-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="truncate font-mono text-base text-ink" title={run.pattern}>
            {run.pattern}
          </h3>
          <p className="mt-1 text-sm text-muted" role={run.state === "running" ? "status" : undefined}>
            {run.state === "running" && run.rendering
              ? `Running JavaScript on ${formatNumber(run.rendering.done)} of ${plural(run.rendering.total, "page")} that build their content in the browser.`
              : run.state === "running"
                ? `Read ${formatNumber(done)} of ${plural(total, "page")}.`
                : `Read ${formatNumber(summary.read.length)} of ${plural(total, "page")}.`}
            {run.state !== "running" && summary.failed > 0 && ` ${formatNumber(summary.failed)} couldn't be read.`}
            {run.state !== "running" &&
              summary.rendered > 0 &&
              ` ${summary.rendered === 1 ? "1 was" : `${formatNumber(summary.rendered)} were`} read after running JavaScript.`}
            {run.state === "stopped" && " Stopped early."}
          </p>
        </div>
        <div className="flex gap-3">
          {run.state === "running" ? (
            <button type="button" onClick={onStop} className={secondaryButton}>
              Stop extracting
            </button>
          ) : (
            <button
              type="button"
              onClick={() => downloadContents(run, host)}
              disabled={done === 0}
              className={secondaryButton}
            >
              <DownloadIcon />
              Download contents CSV
            </button>
          )}
        </div>
      </div>

      {run.state === "running" && (
        <div className="mt-4 h-[3px] w-full overflow-hidden rounded-full bg-contour-soft">
          <div
            className="h-full rounded-full bg-contour"
            style={{
              width: `${
                run.rendering
                  ? (run.rendering.done / Math.max(run.rendering.total, 1)) * 100
                  : total
                    ? (done / total) * 100
                    : 0
              }%`,
            }}
          />
        </div>
      )}

      {run.error && (
        <p role="alert" className="mt-4 max-w-[52ch] border-l-2 border-alert pl-4 text-ink">
          {run.error}
        </p>
      )}

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

      {done > 0 && (
        <ul className="mt-5 divide-y divide-rule rounded-md border border-rule">
          {run.pages.map((page) => (
            <li key={page.url}>
              <PageDetails page={page} origin={origin} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
