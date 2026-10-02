"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

type Group = { pattern: string; count: number; urls: string[] };

type MapResult = {
  origin: string;
  source: "sitemap" | "crawl";
  sitemaps: string[];
  truncated: boolean;
  notes: string[];
  total: number;
  groups: Group[];
};

const MAX_RENDERED_URLS = 500;

const CONTOURS = [
  "M373.9 230.0C374.8 234.5 371.6 240.1 368.8 244.6C366.0 249.0 362.3 254.3 357.2 256.6C352.1 258.8 344.0 257.8 338.2 257.9C332.3 258.0 328.1 257.3 322.1 257.2C316.0 257.1 306.9 259.5 302.1 257.3C297.4 255.0 295.0 248.2 293.6 243.7C292.2 239.1 293.6 234.6 293.6 230.0C293.7 225.4 291.8 220.5 293.7 216.4C295.5 212.2 300.3 208.7 304.7 205.3C309.1 201.8 314.1 196.8 319.9 195.5C325.7 194.2 334.6 195.0 339.5 197.5C344.5 200.0 345.8 207.4 349.7 210.7C353.6 214.1 359.1 214.4 363.1 217.6C367.1 220.8 372.9 225.5 373.9 230.0Z",
  "M425.3 234.0C426.7 243.9 415.1 256.3 407.5 265.4C399.9 274.5 390.8 283.7 379.8 288.6C368.9 293.4 353.9 293.6 341.7 294.4C329.5 295.3 319.6 293.9 306.5 293.8C293.4 293.7 273.3 298.7 262.9 293.7C252.6 288.7 247.2 273.8 244.5 263.9C241.7 253.9 246.8 244.1 246.4 234.0C246.1 223.9 239.0 212.7 242.4 203.4C245.8 194.1 256.8 185.0 266.9 178.1C277.0 171.3 290.1 164.0 302.9 162.0C315.7 160.1 333.2 161.4 343.8 166.4C354.4 171.5 357.4 185.8 366.6 192.4C375.7 199.0 389.0 199.0 398.8 205.9C408.6 212.9 423.8 224.1 425.3 234.0Z",
  "M480.2 238.0C481.0 253.4 456.8 271.9 443.2 285.0C429.5 298.1 414.8 308.9 398.5 316.7C382.2 324.6 363.6 329.4 345.5 332.0C327.5 334.7 310.6 332.8 290.3 332.5C270.0 332.2 239.6 338.2 223.7 330.2C207.8 322.1 198.9 299.6 194.9 284.2C191.0 268.8 200.8 253.8 199.8 238.0C198.9 222.2 184.6 204.4 189.3 189.7C194.0 175.0 211.6 159.4 227.9 149.9C244.2 140.5 267.3 134.8 287.2 132.9C307.1 130.9 330.9 131.6 347.2 138.2C363.6 144.7 370.3 162.9 385.5 172.0C400.7 181.1 422.8 181.7 438.6 192.7C454.4 203.7 479.4 222.6 480.2 238.0Z",
  "M534.7 242.0C533.3 262.8 494.2 286.3 474.1 302.9C453.9 319.4 434.5 329.9 413.8 341.5C393.2 353.1 373.6 366.9 350.2 372.4C326.7 377.9 300.7 375.6 273.2 374.5C245.7 373.4 206.6 377.5 185.3 365.9C164.0 354.2 150.7 325.2 145.4 304.6C140.0 283.9 154.7 263.5 153.1 242.0C151.5 220.5 129.6 195.8 135.6 175.8C141.5 155.7 166.1 133.0 188.9 121.7C211.8 110.4 245.9 109.9 272.8 108.1C299.7 106.3 327.7 104.5 350.3 111.1C373.0 117.6 386.6 136.4 408.6 147.6C430.5 158.8 461.1 162.4 482.1 178.1C503.1 193.9 536.0 221.2 534.7 242.0Z",
  "M584.2 246.0C579.6 272.0 526.2 299.1 500.0 318.9C473.9 338.6 451.4 348.4 427.5 364.7C403.5 381.1 384.8 407.9 356.1 417.1C327.3 426.3 289.6 422.9 255.0 420.1C220.5 417.2 175.0 415.8 148.6 399.9C122.2 384.0 103.7 350.3 96.5 324.7C89.3 299.0 107.8 273.1 105.5 246.0C103.2 218.9 75.0 187.4 82.6 162.1C90.1 136.8 121.2 106.8 150.7 94.1C180.1 81.5 225.5 88.3 259.3 86.5C293.1 84.6 324.1 77.9 353.7 83.2C383.3 88.4 408.0 104.7 437.0 118.0C465.9 131.2 502.9 141.5 527.4 162.9C552.0 184.2 588.7 220.0 584.2 246.0Z",
  "M625.1 250.0C616.9 280.9 553.0 310.4 522.5 333.5C492.0 356.7 468.5 366.5 442.0 388.8C415.5 411.0 397.9 453.7 363.5 467.1C329.2 480.4 277.4 474.7 236.0 468.7C194.6 462.6 146.2 451.6 115.0 430.9C83.9 410.1 58.9 374.3 49.1 344.2C39.3 314.1 59.3 282.5 56.3 250.0C53.4 217.5 21.7 179.5 31.3 149.1C40.8 118.7 77.6 81.4 113.4 67.6C149.2 53.7 205.4 68.3 246.1 65.9C286.8 63.5 320.3 50.0 357.7 52.9C395.1 55.8 434.8 67.5 470.5 83.3C506.1 99.2 545.7 120.3 571.5 148.1C597.3 175.8 633.3 219.1 625.1 250.0Z",
  "M655.6 254.0C644.5 289.5 577.2 321.0 544.6 348.1C512.0 375.2 488.7 387.4 460.1 416.3C431.4 445.3 413.0 505.0 372.5 522.0C331.9 539.0 264.4 529.1 216.6 518.4C168.8 507.7 121.1 483.6 85.6 457.7C50.1 431.8 17.0 397.0 3.5 363.1C-10.0 329.1 8.0 291.7 4.4 254.0C0.9 216.3 -30.1 172.2 -18.0 136.9C-5.9 101.5 35.2 57.3 77.0 41.8C118.7 26.4 185.0 47.9 232.6 44.2C280.2 40.4 316.8 19.3 362.7 19.5C408.5 19.6 466.2 25.9 507.6 45.1C549.1 64.4 586.6 100.1 611.2 134.9C635.9 169.7 666.7 218.5 655.6 254.0Z",
];

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatNumber(count)} ${count === 1 ? singular : pluralForm}`;
}

/** URLs on the site's origin arrive as paths; everything else is absolute. */
function toAbsolute(url: string, origin: string): string {
  return url.startsWith("/") ? origin + url : url;
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy approach.
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

function Icon({ children, className = "size-4" }: { children: React.ReactNode; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {children}
    </svg>
  );
}

const CopyIcon = () => (
  <Icon>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V6a2 2 0 0 1 2-2h8" />
  </Icon>
);

const CheckIcon = () => (
  <Icon>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);

const DownloadIcon = () => (
  <Icon>
    <path d="M12 4v11" />
    <path d="M7.5 10.5L12 15l4.5-4.5" />
    <path d="M5 19h14" />
  </Icon>
);

const ChevronIcon = ({ open }: { open: boolean }) => (
  <Icon className={`size-4 shrink-0 transition-transform duration-150 ${open ? "rotate-90" : ""}`}>
    <path d="M9 6l6 6-6 6" />
  </Icon>
);

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

const secondaryButton =
  "inline-flex h-11 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-rule bg-transparent px-3 text-sm sm:px-4 font-medium text-ink transition-colors hover:border-contour hover:text-contour disabled:cursor-not-allowed disabled:text-muted disabled:hover:border-rule sm:flex-none";

export default function Home() {
  const [domain, setDomain] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MapResult | null>(null);
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const deferredFilter = useDeferredValue(filter);

  useEffect(() => {
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

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
        return { pattern: group.pattern, count: urls.length, urls };
      })
      .filter((group) => group.count > 0)
      .sort((a, b) => b.count - a.count || a.pattern.localeCompare(b.pattern));
  }, [result, searchable, deferredFilter]);

  const visibleTotal = visibleGroups.reduce((sum, group) => sum + group.count, 0);
  const largest = visibleGroups[0]?.count ?? 0;
  const isFiltering = deferredFilter.trim().length > 0;
  const host = result ? new URL(result.origin).hostname : "";

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
      setFilter("");
      setOpen(new Set(next.groups[0] ? [next.groups[0].pattern] : []));
      setCopied(false);
      setCopyError(null);
    } catch {
      setError("Couldn't reach the Sitemapper server. Check your connection and try again.");
    } finally {
      setLoading(false);
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

  async function handleCopy() {
    if (!result) return;
    const text = visibleGroups
      .flatMap((group) => group.urls.map((url) => toAbsolute(url, result.origin)))
      .join("\n");
    const ok = await copyText(text);
    if (!ok) {
      setCopyError("This browser blocked copying. Use Download CSV instead.");
      return;
    }
    setCopyError(null);
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1800);
  }

  function handleDownload() {
    if (!result) return;
    const rows = ["url,pattern"];
    for (const group of visibleGroups) {
      for (const url of group.urls) {
        rows.push(`${csvCell(toAbsolute(url, result.origin))},${csvCell(group.pattern)}`);
      }
    }
    const blob = new Blob([rows.join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `${host}-pages.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
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
              Reads the site&apos;s sitemap, or follows its links if it has none, then groups the pages by URL
              pattern so you can see how the site is built.
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
              placeholder="tiporacle.com"
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              className="h-14 w-full min-w-0 rounded-md sm:flex-1 border border-rule bg-sheet px-4 font-mono text-lg text-ink placeholder:text-muted hover:border-contour/60"
            />
            <button
              type="submit"
              disabled={!domain.trim() || loading}
              className="h-14 shrink-0 rounded-md bg-ink px-7 text-base font-medium text-sheet transition-colors hover:bg-contour disabled:cursor-not-allowed disabled:bg-muted disabled:hover:bg-muted"
            >
              {loading ? "Mapping…" : "Map site"}
            </button>
          </form>

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
              {result.source === "sitemap"
                ? `Found in ${plural(result.sitemaps.length, "sitemap")}.`
                : "Found by following links."}
              {result.notes.map((note) => (
                <span key={note}> {note}</span>
              ))}
            </p>

            {result.total > 0 && (
              <>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
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
                    className="h-11 w-full min-w-0 rounded-md sm:flex-1 border border-rule bg-sheet px-3 text-sm text-ink placeholder:text-muted hover:border-contour/60"
                  />
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={handleCopy}
                      disabled={visibleTotal === 0}
                      className={secondaryButton}
                    >
                      {copied ? <CheckIcon /> : <CopyIcon />}
                      <span aria-live="polite">{copied ? "Copied" : "Copy URLs"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDownload}
                      disabled={visibleTotal === 0}
                      className={secondaryButton}
                    >
                      <DownloadIcon />
                      Download CSV
                    </button>
                  </div>
                </div>

                <div aria-live="polite" className="text-sm text-muted">
                  {copyError && <p className="mt-3 border-l-2 border-alert pl-3 text-ink">{copyError}</p>}
                  {isFiltering && (
                    <p className="mt-3">
                      {formatNumber(visibleTotal)} of {plural(result.total, "URL")}{" "}
                      {visibleTotal === 1 ? "matches" : "match"}.
                    </p>
                  )}
                </div>

                {visibleGroups.length > 0 && (
                  <ul className="mt-5 divide-y divide-rule rounded-md border border-rule">
                    {visibleGroups.map((group, index) => {
                      const isOpen = open.has(group.pattern);
                      const panelId = `group-panel-${index}`;
                      const shown = group.urls.slice(0, MAX_RENDERED_URLS);
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
                            <div
                              id={panelId}
                              className="max-h-96 overflow-y-auto border-t border-rule bg-sheet px-4 py-3"
                            >
                              <ul className="space-y-0.5">
                                {shown.map((url) => (
                                  <li key={url}>
                                    <a
                                      href={toAbsolute(url, result.origin)}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="block truncate py-1 font-mono text-[13px] text-ink hover:text-contour hover:underline"
                                    >
                                      {url}
                                    </a>
                                  </li>
                                ))}
                              </ul>
                              {group.count > MAX_RENDERED_URLS && (
                                <p className="mt-3 text-sm text-muted">
                                  Showing {formatNumber(MAX_RENDERED_URLS)} of {formatNumber(group.count)}. Download
                                  the CSV for the full list.
                                </p>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
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
          </section>
        )}
      </main>
    </div>
  );
}
