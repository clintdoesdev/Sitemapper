"use client";

import type { LinkMap } from "@/lib/aggregate";
import { Bar, Muted, UrlLink } from "./bits";

const n = (value: number) => value.toLocaleString("en-US");

export function LinkMapSection({ linkMap }: { linkMap: LinkMap }) {
  const sources = [...new Set(linkMap.edges.map((edge) => edge.source))];
  const max = Math.max(0, ...linkMap.edges.map((edge) => edge.links), ...linkMap.homepageTargets.map((target) => target.links));
  const rows = [
    ...(linkMap.homepageTargets.length ? [{ source: "Homepage", edges: linkMap.homepageTargets.map((t) => ({ target: t.pattern, links: t.links, pages: 1 })) }] : []),
    ...sources.map((source) => ({ source, edges: linkMap.edges.filter((edge) => edge.source === source) })),
  ];
  return (
    <section aria-labelledby="linkmap-heading" className="mt-14 border-t border-rule pt-10">
      <h2 id="linkmap-heading" className="font-display text-2xl font-bold tracking-tight text-ink">
        Link map
      </h2>
      <p className="mt-2 max-w-[52ch] text-sm text-muted">Which patterns each analysed pattern links to, counted across its sampled pages.</p>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No internal links between mapped patterns were found.</p>
      ) : (
        <ul className="mt-5 divide-y divide-rule border-y border-rule">
          {rows.map((row) => (
            <li key={row.source} className="py-3">
              <p className={row.source === "Homepage" ? "text-sm font-medium text-ink" : "truncate font-mono text-sm text-ink"} title={row.source}>
                {row.source}
              </p>
              <ul className="mt-2 space-y-2 pl-4">
                {row.edges.slice(0, 12).map((edge) => (
                  <li key={edge.target} className="flex items-center gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[13px] text-ink" title={edge.target}>
                        {edge.target}
                      </span>
                      <Bar value={edge.links} max={max} />
                    </span>
                    <span className="shrink-0 text-right text-sm tabular-nums">{n(edge.links)}</span>
                  </li>
                ))}
                {row.edges.length > 12 && <li className="text-sm text-muted">and {n(row.edges.length - 12)} more</li>}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 space-y-3 text-sm">
        <details>
          <summary className="cursor-pointer text-muted hover:text-contour">
            Patterns no sampled page links to ({n(linkMap.unlinked.length)})
          </summary>
          <p className="mt-2 text-muted">Sampling can miss links, so treat this as a lead, not a finding.</p>
          <ul className="mt-2 space-y-0.5 font-mono text-[13px]">
            {linkMap.unlinked.slice(0, 200).map((pattern) => (
              <li key={pattern} className="truncate" title={pattern}>
                {pattern}
              </li>
            ))}
          </ul>
        </details>
        <details>
          <summary className="cursor-pointer text-muted hover:text-contour">
            Linked but not in the sitemap ({n(linkMap.notInSitemap.length)})
          </summary>
          {linkMap.notInSitemap.length === 0 ? (
            <p className="mt-2">
              <Muted>None found.</Muted>
            </p>
          ) : (
            <ul className="mt-2 max-h-72 space-y-0.5 overflow-y-auto">
              {linkMap.notInSitemap.map((url) => (
                <li key={url}>
                  <UrlLink href={url} />
                </li>
              ))}
            </ul>
          )}
        </details>
      </div>
    </section>
  );
}
