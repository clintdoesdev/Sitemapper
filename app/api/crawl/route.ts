import { NextResponse } from "next/server";
import { checkOrigin } from "@/lib/request";
import {
  BlockedHostError,
  CrawlError,
  InvalidDomainError,
  mapSite,
  normalizeDomain,
  type Identity,
} from "@/lib/crawl";
import { groupByPattern } from "@/lib/patterns";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/** The origin most URLs share, so they can be sent as short paths. */
function commonOrigin(urls: string[], fallback: string): string {
  const counts = new Map<string, number>();
  for (const url of urls) {
    const origin = new URL(url).origin;
    counts.set(origin, (counts.get(origin) ?? 0) + 1);
  }
  let best = fallback;
  let bestCount = counts.get(fallback) ?? 0;
  for (const [origin, count] of counts) {
    if (count > bestCount) {
      best = origin;
      bestCount = count;
    }
  }
  return best;
}

export async function POST(request: Request) {
  const rejected = checkOrigin(request);
  if (rejected) return rejected;
  let domain = "";
  let identity: Identity = "bot";
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && "domain" in body && typeof body.domain === "string") {
      domain = body.domain;
    }
    if (body && typeof body === "object" && "identity" in body && body.identity === "browser") identity = "browser";
  } catch {
    // Treated as an empty domain below.
  }
  if (!domain.trim()) return error("Enter a domain, like example.com.", 400);

  let origin: string;
  try {
    origin = normalizeDomain(domain);
  } catch (err) {
    if (err instanceof BlockedHostError || err instanceof InvalidDomainError) return error(err.message, 400);
    return error("That doesn't look like a valid domain.", 400);
  }

  try {
    const started = Date.now();
    let result: Awaited<ReturnType<typeof mapSite>> | null = null;
    let firstError: unknown = null;
    try {
      result = await mapSite(origin, identity);
    } catch (err) {
      if (!(err instanceof CrawlError)) throw err;
      firstError = err;
    }
    // Sites that refuse tools often answer a regular browser: when the first
    // try found next to nothing, map again as one, if there's time left.
    const left = 55_000 - (Date.now() - started);
    if (identity === "bot" && (result === null || result.urls.length <= 1) && left > 15_000) {
      try {
        const again = await mapSite(origin, "browser", left - 5_000);
        if (result === null || again.urls.length > result.urls.length) {
          result = { ...again, notes: [...again.notes, "The site refused SitemapperBot, so pages were found by asking as a regular browser."] };
        }
      } catch (err) {
        if (!(err instanceof CrawlError)) throw err;
      }
    }
    if (!result) throw firstError;
    const siteOrigin = commonOrigin(result.urls, result.origin);
    // URLs on the main origin are sent as paths to keep the response small.
    const groups = groupByPattern(result.urls, result.lastmod).map((group) => ({
      ...group,
      urls: group.urls.map((url) => (url.startsWith(`${siteOrigin}/`) ? url.slice(siteOrigin.length) : url)),
    }));
    return NextResponse.json({
      origin: siteOrigin,
      source: result.source,
      sitemaps: result.sitemaps,
      sitemapStats: result.sitemapStats,
      truncated: result.truncated,
      notes: result.notes,
      total: result.urls.length,
      groups,
    });
  } catch (err) {
    if (err instanceof CrawlError) return error(err.message, 500);
    console.error(err);
    const detail = err instanceof Error && err.message ? ` (${err.message})` : "";
    return error(`Mapping ${new URL(origin).hostname} failed unexpectedly${detail}. Try again in a minute.`, 500);
  }
}
