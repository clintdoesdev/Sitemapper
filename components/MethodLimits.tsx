"use client";

import type { AnalysisState } from "@/lib/analysis-types";
import type { BlockedPage } from "@/lib/issues";
import { UrlLink } from "./bits";

const n = (value: number) => value.toLocaleString("en-US");

export function MethodLimits({ state, blocked }: { state: AnalysisState; blocked: readonly BlockedPage[] }) {
  const pages = [...(state.site ? [state.site.homepage] : []), ...state.patterns.flatMap((result) => result.pages)];
  const requested = pages.filter((page) => page.outcome !== "robots").length;
  const analysed = pages.filter((page) => page.data).length;
  const skipped = [...new Set([...(state.site?.skippedByRobots ?? []), ...pages.filter((page) => page.outcome === "robots").map((page) => page.url)])];
  return (
    <details className="mt-10 text-sm">
      <summary className="cursor-pointer text-muted hover:text-contour">Method and limits</summary>
      <div className="mt-3 max-w-[60ch] space-y-3 text-ink">
        <p>
          Analysed {n(state.patterns.length)} {state.patterns.length === 1 ? "pattern" : "patterns"} with up to {state.pagesPerPattern}{" "}
          {state.pagesPerPattern === 1 ? "page" : "pages"} each, taken from the start, middle and end of each group, plus the homepage.{" "}
          {n(requested)} pages were requested and {n(analysed)} analysed.
        </p>
        <p>
          Site checks read robots.txt first, then ads.txt, app-ads.txt, llms.txt, security.txt, humans.txt, the manifest, the http and
          www variants, both trailing-slash forms of a sample URL and one made-up URL.
        </p>
        <p>
          Requests identify as SitemapperBot/1.0, with at most 4 in flight and a 300 ms pause between batches. Pages stop being read at 3 MB.
          Affiliate and outbound links are recorded, never requested, and redirects that leave the site aren&apos;t followed.
        </p>
        <p>Performance numbers are proxies from the HTML and response time, not Core Web Vitals. Use the PageSpeed Insights links for real measurements.</p>
        <div>
          <p>Skipped because robots.txt disallows them: {skipped.length ? n(skipped.length) : "none"}.</p>
          <ul className="mt-1 space-y-0.5">
            {skipped.slice(0, 50).map((url) => (
              <li key={url}>
                <UrlLink href={url} />
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p>Blocked by bot protection: {blocked.length ? n(blocked.length) : "none"}.</p>
          <ul className="mt-1 space-y-0.5">
            {blocked.slice(0, 50).map((page) => (
              <li key={page.url}>
                <UrlLink href={page.url} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </details>
  );
}
