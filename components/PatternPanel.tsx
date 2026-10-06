"use client";

import { useState } from "react";
import type { PatternResult } from "@/lib/analysis-types";
import type { PageData } from "@/lib/extract/types";
import type { Issue } from "@/lib/issues";
import type { Placeholder } from "@/lib/patterns";
import { Bar, day, ExternalLink, Field, FieldList, Mono, Muted, Notice, percent, Segmented, UrlLink, ValueList } from "./bits";
import { IssueList } from "./IssuesSection";

const n = (value: number) => value.toLocaleString("en-US");
const MAX_RENDERED_URLS = 500;

type Tab = "urls" | "template" | "content" | "links" | "signals" | "issues";
const TABS: { value: Tab; label: string }[] = [
  { value: "urls", label: "URLs" },
  { value: "template", label: "Template" },
  { value: "content", label: "Content" },
  { value: "links", label: "Links" },
  { value: "signals", label: "Ads and trust" },
  { value: "issues", label: "Issues" },
];

export type PanelGroup = {
  pattern: string;
  count: number;
  urls: string[];
  share?: number;
  lastmodNewest?: string | null;
  lastmodOldest?: string | null;
  lastmodCoverage?: number;
  placeholders?: Placeholder[];
};

function toAbsolute(url: string, origin: string): string {
  return url.startsWith("/") ? origin + url : url;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function NotAnalysed() {
  return <p className="text-sm text-muted">Analyse this pattern to see how its pages are built.</p>;
}

function Samples({ result }: { result: PatternResult }) {
  return (
    <div className="mb-4">
      <h4 className="text-sm text-muted">Sampled pages</h4>
      <ul className="mt-1 space-y-2">
        {result.pages.map((page) => (
          <li key={page.url} className="min-w-0">
            <UrlLink href={page.url} />
            {page.outcome === "ok" ? (
              <span className="text-[13px] text-muted">
                status {page.status}, {n(Math.round(page.bytes / 1024))} KB, {n(page.ms)} ms
                {page.redirectChain.length > 0 && `, ${page.redirectChain.length} redirect ${page.redirectChain.length === 1 ? "hop" : "hops"}`}
                {page.truncated && ", cut at 3 MB"}
              </span>
            ) : (
              <div className="mt-1">
                <Notice tone={page.outcome === "robots" ? "muted" : "alert"}>{page.message}</Notice>
              </div>
            )}
          </li>
        ))}
      </ul>
      {result.trimmed.map((note) => (
        <p key={note} className="mt-2 text-sm text-muted">
          {note}
        </p>
      ))}
    </div>
  );
}

function TemplateValue({ value }: { value: { template: string | null; needsMoreSamples: boolean } }) {
  if (!value.template) return <Muted>Nothing shared</Muted>;
  return (
    <>
      <Mono>{value.template}</Mono>
      {value.needsMoreSamples && <Muted> (needs 2+ samples)</Muted>}
    </>
  );
}

function TemplateTab({ result }: { result: PatternResult }) {
  const a = result.aggregate;
  return (
    <FieldList>
      <Field label="Title">
        <TemplateValue value={a.templates.title} />
      </Field>
      <Field label="Meta description">
        <TemplateValue value={a.templates.description} />
      </Field>
      <Field label="H1">
        <TemplateValue value={a.templates.h1} />
      </Field>
      <Field label="og:title">
        <TemplateValue value={a.templates.ogTitle} />
      </Field>
      <Field label="Canonical">{a.canonical.summary}</Field>
      <Field label="og:image">{a.ogImage === "static" ? "Static: the same image on every sample" : a.ogImage === "per page" ? "Per page: different on each sample" : a.ogImage}</Field>
      <Field label="Schema on every sample">
        <ValueList values={a.schema.always} />
      </Field>
      <Field label="Schema on some">
        <ValueList values={a.schema.sometimes} />
      </Field>
      <Field label="Template blocks">
        <ValueList values={a.blocks.always} mono empty="No blocks on every sample" />
      </Field>
      <Field label="Conditional blocks">
        <ValueList values={a.blocks.conditional} mono />
      </Field>
    </FieldList>
  );
}

function ContentTab({ result }: { result: PatternResult }) {
  const a = result.aggregate;
  return (
    <FieldList>
      <Field label="Words">{n(a.averages.words)} on average</Field>
      <Field label="Uniqueness">
        {percent(a.content.uniqueness)}
        <Muted> of 5-word phrases not found on the other samples</Muted>
      </Field>
      <Field label="Templated sentences">
        {a.content.templated.length === 0 ? (
          <Muted>None found</Muted>
        ) : (
          <ul className="space-y-2">
            {a.content.templated.map((sentence) => (
              <li key={sentence.skeleton}>
                <Mono>{sentence.skeleton}</Mono>
                <span className="block text-muted">e.g. {sentence.example}</span>
              </li>
            ))}
          </ul>
        )}
      </Field>
      <Field label="Boilerplate">
        {a.content.boilerplate.length === 0 ? (
          <Muted>None found</Muted>
        ) : (
          <details>
            <summary className="cursor-pointer hover:text-contour">
              {n(a.content.boilerplate.length)} sentences on every sample
            </summary>
            <ul className="mt-2 space-y-1 text-muted">
              {a.content.boilerplate.map((sentence) => (
                <li key={sentence}>{sentence}</li>
              ))}
            </ul>
          </details>
        )}
      </Field>
      <Field label="Tables">
        {a.tables.length === 0 ? (
          <Muted>None</Muted>
        ) : (
          <ul className="space-y-1">
            {a.tables.map((table, index) => (
              <li key={index}>
                {n(table.rows)} rows{table.headers.length > 0 && <Muted>: {table.headers.join(", ")}</Muted>}
              </li>
            ))}
          </ul>
        )}
      </Field>
    </FieldList>
  );
}

function LinksTab({ result, data }: { result: PatternResult; data: PageData[] }) {
  const edges = result.aggregate.outgoing;
  const max = edges[0]?.links ?? 0;
  const unmatched = unique(data.flatMap((page) => page.links.unmatchedInternal));
  return (
    <div className="space-y-5">
      {edges.length === 0 ? (
        <p className="text-sm text-muted">No internal links to mapped patterns.</p>
      ) : (
        <ul className="divide-y divide-rule border-y border-rule">
          {edges.map((edge) => (
            <li key={edge.pattern} className="flex items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[13px]" title={edge.pattern}>
                  {edge.pattern}
                </span>
                <Bar value={edge.links} max={max} />
              </span>
              <span className="shrink-0 text-right text-sm tabular-nums">
                {n(edge.links)} <Muted>from {edge.pages}</Muted>
              </span>
            </li>
          ))}
        </ul>
      )}
      <FieldList>
        <Field label="Averages">
          {n(result.aggregate.averages.internalLinks)} internal, {n(result.aggregate.averages.externalLinks)} external per page
        </Field>
        <Field label="Not in the sitemap">
          {unmatched.length === 0 ? (
            <Muted>None</Muted>
          ) : (
            <details>
              <summary className="cursor-pointer hover:text-contour">{n(unmatched.length)} linked URLs match no pattern</summary>
              <ul className="mt-2 space-y-0.5">
                {unmatched.slice(0, 100).map((url) => (
                  <li key={url}>
                    <UrlLink href={url} />
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Field>
      </FieldList>
    </div>
  );
}

function SignalsTab({ result, data }: { result: PatternResult; data: PageData[] }) {
  const sports = data.map((page) => page.niche.sports).filter((value) => value !== null);
  const flat = <T,>(pick: (page: PageData) => T[]) => unique(data.flatMap(pick));
  const trust = (pick: (page: PageData) => boolean) => data.filter(pick).length;
  const total = data.length;
  return (
    <FieldList>
      <Field label="Ads">
        {data.map((page) => page.signals.ads.count).join(", ")} per page
        {flat((p) => p.signals.ads.markers).length > 0 && <Muted>: {flat((p) => p.signals.ads.markers).slice(0, 8).join(", ")}</Muted>}
        <Muted>. Above the first H2: {data.map((p) => p.signals.ads.aboveFirstH2).join(", ")}.</Muted>
      </Field>
      <Field label="Affiliates">
        <ValueList
          values={[
            ...flat((p) => p.links.affiliate.redirectPaths.map((r) => r.url)).slice(0, 10),
            ...flat((p) => Object.keys(p.links.affiliate.trackingParams)).map((key) => `parameter: ${key}`),
            ...flat((p) => p.links.affiliate.networks.map((net) => `network: ${net.host}`)),
          ]}
          mono
        />
        <Muted>Recorded only; affiliate and outbound links are never requested.</Muted>
      </Field>
      <Field label="Messaging and social">
        <ValueList values={flat((p) => p.links.messaging.map((m) => `${m.kind}: ${m.url}`)).slice(0, 12)} />
      </Field>
      <Field label="Apps">
        <ValueList values={flat((p) => p.links.apps.map((a) => `${a.kind}: ${a.url}`))} />
      </Field>
      <Field label="Conversion">
        login on {trust((p) => p.signals.conversion.login > 0)} of {total}, register on {trust((p) => p.signals.conversion.register > 0)},
        pricing or VIP on {trust((p) => p.signals.conversion.pricing > 0)}, newsletter forms on{" "}
        {trust((p) => p.signals.conversion.newsletterForms > 0)}, popups on {trust((p) => p.signals.conversion.popups > 0)}, locked
        content on {trust((p) => p.signals.conversion.locked > 0)}
        {flat((p) => p.signals.conversion.pushOptIn).length > 0 && <>; push opt-in: {flat((p) => p.signals.conversion.pushOptIn).join(", ")}</>}.
        {flat((p) => p.signals.prices).length > 0 && <Muted> Prices: {flat((p) => p.signals.prices).slice(0, 10).join(", ")}.</Muted>}
      </Field>
      <Field label="Trust">
        18+ notice on {trust((p) => p.signals.trust.ageNotice)} of {total}, responsible gambling on{" "}
        {trust((p) => p.signals.trust.responsibleGambling)}, privacy on {trust((p) => p.signals.trust.privacy)}, terms on{" "}
        {trust((p) => p.signals.trust.terms)}, about on {trust((p) => p.signals.trust.about)}, contact on{" "}
        {trust((p) => p.signals.trust.contact)}, author on {trust((p) => p.signals.trust.author)}, editorial policy on{" "}
        {trust((p) => p.signals.trust.editorialPolicy)}.
        {flat((p) => p.signals.trust.helpOrganisations).length > 0 && <> Help organisations: {flat((p) => p.signals.trust.helpOrganisations).join(", ")}.</>}
        {flat((p) => p.signals.trust.licence).length > 0 && <> Licences: {flat((p) => p.signals.trust.licence).join(", ")}.</>}
      </Field>
      <Field label="Niche">
        {unique(data.map((p) => p.niche.niche)).join(", ")}
        {data[0]?.niche.signals.length ? <Muted>: {data[0].niche.signals.join(", ")}</Muted> : null}
      </Field>
      {sports.length > 0 && (
        <Field label="Betting data">
          <ul className="space-y-0.5">
            <li>Fixtures: {unique(sports.flatMap((s) => s.fixtures)).slice(0, 6).join(", ") || "none"}</li>
            <li>Kickoff times: {unique(sports.flatMap((s) => [...s.kickoffTimes, ...s.timezones])).slice(0, 8).join(", ") || "none"}</li>
            <li>Markets: {unique(sports.flatMap((s) => s.markets)).join(", ") || "none"}</li>
            <li>
              Odds: {sports.reduce((sum, s) => sum + s.odds.count, 0)} values ({unique(sports.flatMap((s) => s.odds.formats)).join(", ") || "none"})
              {unique(sports.flatMap((s) => s.odds.examples)).length > 0 && <Muted>, e.g. {unique(sports.flatMap((s) => s.odds.examples)).slice(0, 10).join(", ")}</Muted>}
            </li>
            <li>Bookmakers: {unique(sports.flatMap((s) => s.bookmakers)).join(", ") || "none"}</li>
            <li>Tip labels: {unique(sports.flatMap((s) => s.tipLabels)).slice(0, 8).join(", ") || "none"}</li>
            <li>Confidence: {unique(sports.flatMap((s) => s.confidence)).slice(0, 8).join(", ") || "none"}</li>
            <li>Acca terms: {unique(sports.flatMap((s) => s.accaTerms)).join(", ") || "none"}</li>
            <li>Booking codes: {unique(sports.flatMap((s) => s.bookingCodes)).join(", ") || "none"}</li>
            <li>
              Results:{" "}
              {Object.entries(
                sports.reduce<Record<string, number>>((acc, s) => {
                  for (const [key, value] of Object.entries(s.results)) acc[key] = (acc[key] ?? 0) + value;
                  return acc;
                }, {}),
              )
                .map(([key, value]) => `${key} ${value}`)
                .join(", ") || "none"}
            </li>
          </ul>
        </Field>
      )}
      <Field label="Performance proxies">
        {n(result.aggregate.averages.htmlKb)} KB HTML, {n(result.aggregate.averages.responseMs)} ms response,{" "}
        {n(result.aggregate.averages.scripts)} scripts, {n(result.aggregate.averages.images)} images on average;{" "}
        {data.map((p) => `${p.perf.lazyShare}%`).join(", ")} lazy-loaded images.
        <Muted> Proxies from the HTML, not Core Web Vitals.</Muted>
      </Field>
      <Field label="Validators">
        <ul className="space-y-2">
          {result.pages
            .filter((page) => page.data)
            .map((page) => (
              <li key={page.url} className="min-w-0">
                <span className="block truncate font-mono text-[13px] text-muted" title={page.url}>
                  {page.url}
                </span>
                <span className="flex flex-wrap gap-x-3">
                  <ExternalLink href={page.data!.perf.validators.pageSpeed}>PageSpeed Insights</ExternalLink>
                  <ExternalLink href={page.data!.perf.validators.richResults}>Rich Results Test</ExternalLink>
                  <ExternalLink href={page.data!.perf.validators.schemaValidator}>Schema Markup Validator</ExternalLink>
                </span>
              </li>
            ))}
        </ul>
      </Field>
    </FieldList>
  );
}

export function PatternPanel({
  id,
  group,
  origin,
  result,
  issues,
  running,
  canAnalyse,
  onAnalyse,
}: {
  id: string;
  group: PanelGroup;
  origin: string;
  result: PatternResult | undefined;
  issues: Issue[];
  running: boolean;
  canAnalyse: boolean;
  onAnalyse: () => void;
}) {
  const [tab, setTab] = useState<Tab>("urls");
  const data = (result?.pages ?? []).map((page) => page.data).filter((value): value is PageData => value !== null);
  const shown = group.urls.slice(0, MAX_RENDERED_URLS);

  return (
    <div id={id} className="border-t border-rule bg-sheet px-4 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented legend={`View for ${group.pattern}`} options={TABS} value={tab} onChange={setTab} size="sm" />
        <button
          type="button"
          onClick={onAnalyse}
          disabled={!canAnalyse}
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-rule px-3 text-sm font-medium whitespace-nowrap text-ink transition-colors hover:border-contour hover:text-contour disabled:cursor-not-allowed disabled:text-muted disabled:hover:border-rule"
        >
          {running ? "Analysing…" : result ? "Analyse this pattern again" : "Analyse this pattern"}
        </button>
      </div>

      <div className="mt-4">
        {tab !== "urls" && result && <Samples result={result} />}
        {tab === "urls" && (
          <>
            <p className="text-sm text-muted">
              {group.share !== undefined && <>{group.share}% of all pages. </>}
              {group.lastmodNewest ? (
                <>
                  Newest lastmod {day(group.lastmodNewest)}, oldest {day(group.lastmodOldest ?? null)}, {group.lastmodCoverage}% of URLs
                  have one.
                </>
              ) : (
                <>No lastmod dates.</>
              )}
            </p>
            {(group.placeholders ?? []).length > 0 && (
              <ul className="mt-2 space-y-0.5 text-sm">
                {group.placeholders!.map((placeholder) => (
                  <li key={placeholder.position}>
                    Segment {placeholder.position + 1}: {placeholder.kind}{" "}
                    <Muted>
                      (e.g. <Mono>{placeholder.examples.join(", ")}</Mono>)
                    </Muted>
                  </li>
                ))}
              </ul>
            )}
            <ul className="mt-3 max-h-96 space-y-0.5 overflow-y-auto">
              {shown.map((url) => (
                <li key={url}>
                  <a
                    href={toAbsolute(url, origin)}
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
                Showing {n(MAX_RENDERED_URLS)} of {n(group.count)}. Download the CSV for the full list.
              </p>
            )}
          </>
        )}
        {tab !== "urls" && !result && <NotAnalysed />}
        {tab === "template" && result && <TemplateTab result={result} />}
        {tab === "content" && result && <ContentTab result={result} />}
        {tab === "links" && result && <LinksTab result={result} data={data} />}
        {tab === "signals" && result && (data.length ? <SignalsTab result={result} data={data} /> : <p className="text-sm text-muted">No page in this sample could be analysed.</p>)}
        {tab === "issues" && result && (issues.length ? <IssueList issues={issues} /> : <p className="text-sm text-muted">No issues found in this pattern&apos;s samples.</p>)}
      </div>
    </div>
  );
}
