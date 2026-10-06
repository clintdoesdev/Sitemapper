"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon, DownloadIcon, copyText, downloadCsv, downloadText } from "@/app/ui";
import type { AnalysisState } from "@/lib/analysis-types";
import { fullJson, PAGE_DATA_HEADER, pageDataRows } from "@/lib/exports";
import { buildReport } from "@/lib/report";

const mainButton =
  "inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-ink bg-ink px-4 text-sm font-medium whitespace-nowrap text-sheet transition-colors hover:border-contour hover:bg-contour disabled:cursor-not-allowed disabled:border-rule disabled:bg-transparent disabled:text-muted sm:w-56";
const smallButton =
  "inline-flex items-center gap-1.5 text-sm text-ink underline decoration-rule underline-offset-2 hover:text-contour hover:decoration-contour disabled:cursor-not-allowed disabled:text-muted disabled:no-underline";

function useFlag(): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return [
    on,
    () => {
      setOn(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setOn(false), 1800);
    },
  ];
}

function Row({
  button,
  text,
  extra,
}: {
  button: React.ReactNode;
  text: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <li className="flex flex-col gap-2 py-4 sm:flex-row sm:items-start sm:gap-5">
      <div className="shrink-0">{button}</div>
      <div className="min-w-0 text-sm leading-relaxed text-muted">
        {text}
        {extra && <div className="mt-1">{extra}</div>}
      </div>
    </li>
  );
}

/** Every download in one place, each with a plain description of what's inside. */
export function DownloadPanel({
  host,
  state,
  groupsWithUrls,
  pageCount,
  filtered,
  hasContents,
  onDownloadPages,
  onCopyUrls,
}: {
  host: string;
  state: AnalysisState | null;
  groupsWithUrls: readonly { pattern: string; urls: string[] }[];
  /** Pages in the page list (after any filter). */
  pageCount: number;
  filtered: boolean;
  hasContents: boolean;
  onDownloadPages: () => void;
  onCopyUrls: () => Promise<boolean>;
}) {
  const [urlsCopied, flagUrls] = useFlag();
  const [reportCopied, flagReport] = useFlag();
  const [error, setError] = useState<string | null>(null);
  const studied = state !== null && (state.patterns.length > 0 || state.site !== null);
  const needsStudy = <span className="text-ink">Available after you study sample pages (below).</span>;

  async function copyUrls() {
    if (await onCopyUrls()) {
      setError(null);
      flagUrls();
    } else setError("This browser blocked copying. Use the download instead.");
  }

  async function copyReport() {
    if (!state) return;
    if (await copyText(buildReport(state))) {
      setError(null);
      flagReport();
    } else setError("This browser blocked copying. Use Download report instead.");
  }

  return (
    <section aria-labelledby="download-heading" className="mt-10">
      <h2 id="download-heading" className="font-display text-2xl font-bold tracking-tight text-ink">
        Download
      </h2>
      <ul className="mt-2 divide-y divide-rule border-y border-rule">
        <Row
          button={
            <button type="button" onClick={onDownloadPages} disabled={pageCount === 0} className={mainButton}>
              <DownloadIcon />
              Download page list
            </button>
          }
          text={
            <>
              <span className="text-ink">A spreadsheet of {filtered ? `the ${pageCount.toLocaleString("en-US")} pages matching your filter` : "every page"} and its URL pattern.</span>{" "}
              Opens in Excel or Google Sheets.
              {hasContents && " It also has each page's title, headings and text, from Read every page."}
            </>
          }
          extra={
            <button type="button" onClick={copyUrls} disabled={pageCount === 0} className={smallButton}>
              {urlsCopied ? <CheckIcon /> : <CopyIcon />}
              <span aria-live="polite">{urlsCopied ? "Copied" : "Copy the page links instead"}</span>
            </button>
          }
        />
        <Row
          button={
            <button
              type="button"
              onClick={() => state && downloadText(`${host}-sitemapper-report.md`, buildReport(state), "text/markdown;charset=utf-8")}
              disabled={!studied}
              className={mainButton}
            >
              <DownloadIcon />
              Download report
            </button>
          }
          text={
            <>
              <span className="text-ink">A readable summary of how the site is built:</span> page templates, tech, links, money-making and
              problems. A text file you can open in any notes app. {!studied && needsStudy}
            </>
          }
          extra={
            studied ? (
              <button type="button" onClick={copyReport} className={smallButton}>
                {reportCopied ? <CheckIcon /> : <CopyIcon />}
                <span aria-live="polite">{reportCopied ? "Copied" : "Copy the report instead"}</span>
              </button>
            ) : null
          }
        />
        <Row
          button={
            <button
              type="button"
              onClick={() => state && downloadCsv(`${host}-pages-analysed.csv`, PAGE_DATA_HEADER, pageDataRows(state))}
              disabled={!studied}
              className={mainButton}
            >
              <DownloadIcon />
              Download studied pages
            </button>
          }
          text={
            <>
              <span className="text-ink">A spreadsheet with one row per studied page:</span> title, word count, schema, links, speed and
              problems. {!studied && needsStudy}
            </>
          }
        />
        <Row
          button={
            <button
              type="button"
              onClick={() => state && downloadText(`${host}-sitemapper.json`, fullJson(state, groupsWithUrls), "application/json")}
              disabled={!studied}
              className={mainButton}
            >
              <DownloadIcon />
              Download everything
            </button>
          }
          text={
            <>
              <span className="text-ink">All results in one JSON file,</span> for developers or other tools. {!studied && needsStudy}
            </>
          }
        />
      </ul>
      {error && <p className="mt-3 border-l-2 border-alert pl-3 text-sm text-ink">{error}</p>}
    </section>
  );
}
