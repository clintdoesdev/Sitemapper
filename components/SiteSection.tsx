"use client";

import type { StackSummary } from "@/lib/aggregate";
import type { MapSummary } from "@/lib/analysis-types";
import type { AdsTxt, FileCheck, SiteReport } from "@/lib/site";
import { ExternalLink, Field, FieldList, Mono, Muted, Notice } from "./bits";

const n = (value: number) => value.toLocaleString("en-US");

function fileLine(file: FileCheck, presentText: string) {
  if (file.present) return <>{presentText}</>;
  return <Muted>Missing{file.note ? `: ${file.note}` : ""}</Muted>;
}

function adsLine(file: AdsTxt) {
  return fileLine(
    file,
    `Present: ${n(file.lines)} lines, ${n(file.direct)} DIRECT, ${n(file.reseller)} RESELLER, ${n(file.domains.length)} ad systems${
      file.ownerDomain ? `, OWNERDOMAIN ${file.ownerDomain}` : ""
    }${file.managerDomain ? `, MANAGERDOMAIN ${file.managerDomain}` : ""}.`,
  );
}

export function SiteSection({ site, map, stack }: { site: SiteReport; map: MapSummary; stack: StackSummary }) {
  const robots = site.robots;
  const star = robots.groups.find((group) => group.agents.includes("*"));
  const blockedBots = robots.aiBots.filter((bot) => bot.access !== "allowed");
  const autoSitemaps = map.sitemapStats.filter((stat) => stat.autoLastmod);
  const withLastmod = map.sitemapStats.reduce((sum, stat) => sum + stat.withLastmod, 0);
  const entries = map.sitemapStats.filter((stat) => stat.kind === "urlset").reduce((sum, stat) => sum + stat.urls, 0);
  const extensions = [
    ...new Set(map.sitemapStats.flatMap((stat) => Object.entries(stat.extensions).filter(([, used]) => used).map(([name]) => name))),
  ];
  const categories = [...new Set(stack.thirdParties.map((party) => party.category))];
  const h = site.host;

  return (
    <section aria-labelledby="site-heading" className="mt-12">
      <h2 id="site-heading" className="font-display text-2xl font-bold tracking-tight text-ink">
        Site
      </h2>
      <FieldList className="mt-4">
        <Field label="robots.txt">
          {robots.present ? (
            <>
              {n(robots.groups.length)} user-agent {robots.groups.length === 1 ? "group" : "groups"}
              {star && star.disallow.length > 0 && <>, {n(star.disallow.length)} disallow {star.disallow.length === 1 ? "rule" : "rules"} for all agents</>}
              {star?.crawlDelay != null && <>, crawl-delay {star.crawlDelay}</>}.{" "}
              {blockedBots.length > 0 ? (
                <>AI crawlers: {blockedBots.map((bot) => `${bot.bot} ${bot.access}`).join(", ")}.</>
              ) : (
                <Muted>No AI crawler is blocked.</Muted>
              )}
              <details className="mt-2">
                <summary className="cursor-pointer text-muted hover:text-contour">Show robots.txt</summary>
                <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-rule bg-sheet p-3 font-mono text-[12px] leading-relaxed whitespace-pre">
                  {robots.text}
                  {robots.truncated && "\n[cut at 20 KB]"}
                </pre>
              </details>
            </>
          ) : (
            <Muted>Missing (status {robots.status || "no response"}).</Muted>
          )}
        </Field>
        <Field label="Sitemaps">
          {map.sitemaps.length ? (
            <>
              {n(map.sitemaps.length)} read, {n(entries)} entries, {n(withLastmod)} with lastmod
              {extensions.length > 0 && <>, uses {extensions.join(", ")}</>}.{" "}
              {autoSitemaps.length > 0 && (
                <span className="text-alert">
                  lastmod looks auto-generated in {n(autoSitemaps.length)} {autoSitemaps.length === 1 ? "sitemap" : "sitemaps"}.
                </span>
              )}
            </>
          ) : (
            <Muted>None found; pages came from following links.</Muted>
          )}
        </Field>
        <Field label="ads.txt">{adsLine(site.files.adsTxt)}</Field>
        <Field label="app-ads.txt">{adsLine(site.files.appAdsTxt)}</Field>
        <Field label="llms.txt">
          {fileLine(site.files.llmsTxt, `Present, ${n(site.files.llmsTxt.bytes)} bytes.`)}
          {site.files.llmsTxt.firstLines.length > 0 && (
            <pre className="mt-2 max-h-48 overflow-auto rounded-md border border-rule bg-sheet p-3 font-mono text-[12px] whitespace-pre">
              {site.files.llmsTxt.firstLines.join("\n")}
            </pre>
          )}
        </Field>
        <Field label="security.txt">{fileLine(site.files.securityTxt, "Present.")}</Field>
        <Field label="humans.txt">{fileLine(site.files.humansTxt, "Present.")}</Field>
        <Field label="Manifest">
          {site.files.manifest.present ? (
            <>Present{site.files.manifest.name ? `: ${site.files.manifest.name}` : ""}.</>
          ) : (
            <Muted>{site.files.manifest.note ?? "Missing."}</Muted>
          )}
        </Field>
        <Field label="HTTPS">
          {h.https.redirectsToHttps ? (
            <>http redirects to https in {h.https.hops} {h.https.hops === 1 ? "hop" : "hops"}.</>
          ) : (
            <span className="text-alert">http doesn&apos;t redirect to https{h.https.error ? ` (${h.https.error})` : ""}.</span>
          )}
          {site.headers.strictTransportSecurity && <Muted> HSTS is set.</Muted>}
        </Field>
        <Field label="Canonical host">
          {h.canonicalHost.winner === "both serve pages" ? <span className="text-alert">{h.canonicalHost.note}</span> : <>{h.canonicalHost.winner}. <Muted>{h.canonicalHost.note}</Muted></>}
        </Field>
        <Field label="Trailing slash">{h.trailingSlash ? h.trailingSlash.note : <Muted>Not checked.</Muted>}</Field>
        <Field label="404 handling">
          <span className={h.notFound.kind === "real 404" ? "" : "text-alert"}>{h.notFound.note}</span>
        </Field>
        <Field label="Stack">
          {[...stack.cms, ...stack.frameworks].length ? (
            [...stack.cms, ...stack.frameworks].map((item) => item.name).join(", ")
          ) : (
            <Muted>Not identified</Muted>
          )}
        </Field>
        <Field label="Rendering">
          {n(stack.rendering.server)} server-rendered, {n(stack.rendering.client)} mostly client-rendered{" "}
          <Muted>({n(stack.pages)} pages)</Muted>
        </Field>
        <Field label="Hosting and CDN">
          {stack.hosting.length ? stack.hosting.map((item) => item.name).join(", ") : <Muted>Not identified</Muted>}
          {(site.headers.cfCacheStatus || site.headers.vercelCache || site.headers.xCache) && (
            <Muted> Cache: {site.headers.cfCacheStatus || site.headers.vercelCache || site.headers.xCache}.</Muted>
          )}
        </Field>
        <Field label="Third parties">
          {stack.thirdParties.length === 0 ? (
            <Muted>None found</Muted>
          ) : (
            <>
              {n(stack.thirdParties.length)} hosts in {n(categories.length)} categories.
              <div className="mt-1 space-y-1">
                {categories.map((category) => {
                  const parties = stack.thirdParties.filter((party) => party.category === category);
                  return (
                    <details key={category}>
                      <summary className="cursor-pointer text-muted hover:text-contour">
                        {category} ({n(parties.length)})
                      </summary>
                      <ul className="mt-1 mb-2 space-y-0.5 pl-4">
                        {parties.map((party) => (
                          <li key={party.host} className="break-words">
                            {party.name && <>{party.name} </>}
                            <Mono>{party.host}</Mono> <Muted>on {n(party.pages)} {party.pages === 1 ? "page" : "pages"}</Muted>
                          </li>
                        ))}
                      </ul>
                    </details>
                  );
                })}
              </div>
            </>
          )}
        </Field>
        <Field label="Homepage">
          {site.homepage.outcome === "ok" ? (
            <>
              <ExternalLink href={site.homepage.url}>{site.homepage.url}</ExternalLink>{" "}
              <Muted>
                status {site.homepage.status}, {n(Math.round(site.homepage.bytes / 1024))} KB, {n(site.homepage.ms)} ms
              </Muted>
            </>
          ) : (
            <Notice>{site.homepage.message}</Notice>
          )}
        </Field>
      </FieldList>
    </section>
  );
}
