"use client";

import { useEffect, useRef, useState } from "react";
import { makeZip, slugForUrl } from "@/lib/zip";
import { csvCell, DownloadIcon, formatNumber, plural, secondaryButton } from "./ui";

type Device = "desktop" | "phone";
type Captured = { url: string; pattern: string; ok: true; image: Uint8Array; width: number; height: number; truncated: boolean };
type Missed = { url: string; pattern: string; ok: false; error: string };
type ShotResult = Captured | Missed;
type Run = { state: "running" | "done" | "stopped" | "failed"; done: number; total: number; error: string | null };

/** Screenshot requests in flight; each opens its own browser on the server. */
const SHOT_WORKERS = 3;
const DEVICES: { value: Device; label: string }[] = [
  { value: "desktop", label: "Desktop" },
  { value: "phone", label: "Phone" },
];

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function csvLine(cells: string[]): string {
  return cells.map(csvCell).join(",");
}

function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 1 })} MB`;
}

export function ScreenshotsPanel({
  host,
  targets,
  perGroupControl,
  disabled,
  onRunningChange,
}: {
  host: string;
  targets: { url: string; pattern: string }[];
  perGroupControl: React.ReactNode;
  /** True while something else (Get page contents) is running. */
  disabled: boolean;
  onRunningChange: (running: boolean) => void;
}) {
  const [device, setDevice] = useState<Device>("desktop");
  const [shots, setShots] = useState<Map<string, ShotResult>>(new Map());
  const shotsRef = useRef(shots);
  shotsRef.current = shots;
  const [run, setRun] = useState<Run | null>(null);
  const abort = useRef<AbortController | null>(null);
  const running = run?.state === "running";

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => onRunningChange(running), [running, onRunningChange]);

  // Screenshots belong to one site and one device; start over when either changes.
  const key = `${host}|${device}`;
  const lastKey = useRef(key);
  useEffect(() => {
    if (lastKey.current === key) return;
    lastKey.current = key;
    abort.current?.abort();
    setShots(new Map());
    setRun(null);
  }, [key]);

  const captured = targets.map((target) => shots.get(target.url)).filter((shot): shot is Captured => shot?.ok === true);
  const missed = running ? [] : targets.map((target) => shots.get(target.url)).filter((shot): shot is Missed => shot?.ok === false);
  const totalBytes = captured.reduce((sum, shot) => sum + shot.image.byteLength, 0);

  async function start() {
    if (running || disabled) return;
    const pending = targets.filter((target) => shotsRef.current.get(target.url)?.ok !== true);
    if (pending.length === 0) {
      setRun({ state: "done", done: 0, total: 0, error: null });
      return;
    }
    const controller = new AbortController();
    abort.current = controller;
    setRun({ state: "running", done: 0, total: pending.length, error: null });
    const robotsTxt: Record<string, string> = {};
    let next = 0;
    let fatal: string | null = null;

    const shoot = async (target: { url: string; pattern: string }): Promise<ShotResult> => {
      const response = await fetch("/api/screenshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: target.url, device, robotsTxt }),
        signal: controller.signal,
      });
      const data = (await response.json().catch(() => null)) as {
        ok?: boolean;
        image?: string;
        width?: number;
        height?: number;
        truncated?: boolean;
        error?: string;
        robotsTxt?: Record<string, string>;
      } | null;
      if (data?.robotsTxt) Object.assign(robotsTxt, data.robotsTxt);
      if (!response.ok || !data) {
        const message =
          data?.error ??
          (response.status === 504 ? "Took longer than a minute." : `The server returned an error (status ${response.status}).`);
        // A server that can't start its browser won't manage the next page either.
        if (response.status === 500) fatal = message;
        return { ...target, ok: false, error: message };
      }
      if (data.ok && data.image) {
        return {
          ...target,
          ok: true,
          image: base64ToBytes(data.image),
          width: data.width ?? 0,
          height: data.height ?? 0,
          truncated: data.truncated === true,
        };
      }
      return { ...target, ok: false, error: data.error ?? "Couldn't take the screenshot." };
    };

    try {
      await Promise.all(
        Array.from({ length: Math.min(SHOT_WORKERS, pending.length) }, async () => {
          while (next < pending.length && !fatal) {
            const target = pending[next++];
            const shot = await shoot(target);
            setShots((current) => new Map(current).set(target.url, shot));
            setRun((current) => current && { ...current, done: current.done + 1 });
          }
        }),
      );
      setRun((current) => current && { ...current, state: fatal ? "failed" : "done", error: fatal });
    } catch {
      const error = controller.signal.aborted ? null : "Couldn't reach the Sitemapper server. Check your connection and try again.";
      setRun((current) => current && { ...current, state: error ? "failed" : "stopped", error });
    } finally {
      if (abort.current === controller) abort.current = null;
    }
  }

  function downloadZip() {
    const width = String(captured.length).length;
    const files = captured.map((shot, index) => ({
      shot,
      name: `${String(index + 1).padStart(Math.max(3, width), "0")}-${slugForUrl(shot.url)}.jpg`,
    }));
    const encoder = new TextEncoder();
    const index = [
      csvLine(["file", "url", "pattern", "width", "height", "cut_short"]),
      ...files.map(({ shot, name }) =>
        csvLine([name, shot.url, shot.pattern, String(shot.width), String(shot.height), shot.truncated ? "yes" : "no"]),
      ),
    ].join("\r\n");
    const entries = [
      ...files.map(({ shot, name }) => ({ name, data: shot.image })),
      { name: "screenshots.csv", data: encoder.encode(`﻿${index}\r\n`) },
    ];
    const zip = makeZip(entries);
    const blob = new Blob([zip as BlobPart], { type: "application/zip" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${host}-screenshots-${device}.zip`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  }

  function open(shot: Captured) {
    const url = URL.createObjectURL(new Blob([shot.image as BlobPart], { type: "image/jpeg" }));
    window.open(url, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  const progress = run && run.total ? run.done / run.total : 0;

  return (
    <div>
      <p className="max-w-[52ch] text-sm leading-relaxed text-muted">
        Opens each page in a real browser, scrolls to the bottom so everything loads, and takes one picture of the whole
        page. Very long pages are cut at {formatNumber(15_000)} pixels. Keep this page open until it finishes.
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        {perGroupControl}
        <label className="flex items-center gap-3 text-sm text-ink">
          Screen
          <select
            value={device}
            onChange={(event) => setDevice(event.target.value as Device)}
            disabled={running}
            className="h-12 rounded-md border border-rule bg-sheet px-3 text-base text-ink hover:border-contour/60 disabled:text-muted"
          >
            {DEVICES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-4">
        <button
          type="button"
          onClick={start}
          disabled={targets.length === 0 || running || disabled}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md bg-ink px-5 text-base font-medium whitespace-nowrap text-sheet transition-colors hover:bg-contour disabled:cursor-not-allowed disabled:bg-muted disabled:hover:bg-muted sm:w-auto"
        >
          {running ? "Taking screenshots…" : `Take screenshots (${formatNumber(targets.length)})`}
        </button>
        {disabled && !running && <p className="mt-2 text-sm text-muted">Available when Get page contents has finished.</p>}
      </div>

      {run && (
        <div className="mt-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p role="status" className="text-sm text-muted">
              {run.state === "running"
                ? `Screenshotted ${formatNumber(run.done)} of ${plural(run.total, "page")}.`
                : run.state === "stopped"
                  ? `Stopped after ${plural(run.done, "page")}. Press Take screenshots again to continue.`
                  : run.state === "failed"
                    ? `Stopped after ${plural(run.done, "page")}.`
                    : `Done. ${plural(captured.length, "screenshot")} ready.`}
              {!running && missed.length > 0 && ` ${formatNumber(missed.length)} couldn't be taken and are left out of the zip.`}
            </p>
            {running && (
              <button type="button" onClick={() => abort.current?.abort()} className={secondaryButton.replace("flex-1 ", "")}>
                Stop
              </button>
            )}
          </div>
          {running && (
            <div className="mt-3 h-[3px] w-full overflow-hidden rounded-full bg-contour-soft">
              <div className="h-full rounded-full bg-contour" style={{ width: `${progress * 100}%` }} />
            </div>
          )}
          {run.error && <p className="mt-3 max-w-[52ch] border-l-2 border-alert pl-4 text-sm text-ink">{run.error}</p>}
        </div>
      )}

      <div className="mt-8">
        <button
          type="button"
          onClick={downloadZip}
          disabled={captured.length === 0}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-md border border-rule px-5 text-base font-medium whitespace-nowrap text-ink transition-colors hover:border-contour hover:text-contour disabled:cursor-not-allowed disabled:text-muted disabled:hover:border-rule sm:w-auto"
        >
          <DownloadIcon />
          Download screenshots (.zip)
        </button>
        <p className="mt-2 text-sm text-muted">
          {captured.length > 0
            ? `${plural(captured.length, "JPEG image")}, ${megabytes(totalBytes)}, numbered in page-list order, with screenshots.csv listing which file is which page.`
            : "Take screenshots first."}
        </p>
      </div>

      {(captured.length > 0 || missed.length > 0) && (
        <details className="mt-6 text-sm">
          <summary className="cursor-pointer text-muted hover:text-contour">Pages ({formatNumber(captured.length + missed.length)})</summary>
          <ul className="mt-3 divide-y divide-rule rounded-md border border-rule">
            {[...captured, ...missed].map((shot) => (
              <li key={shot.url} className="px-4 py-2.5">
                {shot.ok ? (
                  <button type="button" onClick={() => open(shot)} className="block w-full truncate text-left font-mono text-[13px] text-ink hover:text-contour hover:underline">
                    {shot.url}
                  </button>
                ) : (
                  <span className="block truncate font-mono text-[13px] text-ink">{shot.url}</span>
                )}
                <span className={`block text-[13px] ${shot.ok ? "text-muted" : "text-alert"}`}>
                  {shot.ok
                    ? `${formatNumber(shot.width)} by ${formatNumber(shot.height)} pixels${shot.truncated ? ", cut short" : ""}`
                    : shot.error}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
