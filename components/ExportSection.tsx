"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon, DownloadIcon, copyText, downloadCsv, downloadText, secondaryButton } from "@/app/ui";
import type { AnalysisState } from "@/lib/analysis-types";
import { fullJson, PAGE_DATA_HEADER, pageDataRows } from "@/lib/exports";
import { buildReport } from "@/lib/report";

export function ExportSection({
  state,
  groupsWithUrls,
}: {
  state: AnalysisState;
  groupsWithUrls: readonly { pattern: string; urls: string[] }[];
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const host = state.map.host;

  async function copyReport() {
    const ok = await copyText(buildReport(state));
    if (!ok) {
      setError("This browser blocked copying. Use Download report instead.");
      return;
    }
    setError(null);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1800);
  }

  return (
    <section aria-labelledby="export-heading" className="mt-14 border-t border-rule pt-10">
      <h2 id="export-heading" className="font-display text-2xl font-bold tracking-tight text-ink">
        Export
      </h2>
      <p className="mt-2 max-w-[52ch] text-sm text-muted">
        The report is Markdown with every sampled URL as a link. The JSON holds the full result, including every mapped URL.
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" onClick={copyReport} className={secondaryButton}>
          {copied ? <CheckIcon /> : <CopyIcon />}
          <span aria-live="polite">{copied ? "Copied" : "Copy report"}</span>
        </button>
        <button
          type="button"
          onClick={() => downloadText(`${host}-sitemapper-report.md`, buildReport(state), "text/markdown;charset=utf-8")}
          className={secondaryButton}
        >
          <DownloadIcon />
          Download report
        </button>
        <button
          type="button"
          onClick={() => downloadText(`${host}-sitemapper.json`, fullJson(state, groupsWithUrls), "application/json")}
          className={secondaryButton}
        >
          <DownloadIcon />
          Download JSON
        </button>
        <button
          type="button"
          onClick={() => downloadCsv(`${host}-pages-analysed.csv`, PAGE_DATA_HEADER, pageDataRows(state))}
          className={secondaryButton}
        >
          <DownloadIcon />
          Download page data
        </button>
      </div>
      {error && <p className="mt-3 border-l-2 border-alert pl-3 text-sm text-ink">{error}</p>}
    </section>
  );
}
