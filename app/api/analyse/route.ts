import { NextResponse } from "next/server";
import { Budget } from "@/lib/fetcher";
import { analyseUrls } from "@/lib/extract";
import { fetchPage } from "@/lib/fetcher";
import { sameSite } from "@/lib/guard";
import { checkOrigin, jsonError, readJson } from "@/lib/request";
import { parseRobots } from "@/lib/robots";
import { fitResponse } from "@/lib/trim";
import { parseOrigin, parsePatterns, parseSiteUrl, ValidationError } from "@/lib/validate";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MAX_URLS = 3;

/** POST { origin, pattern, urls (max 3), patterns (max 500), robotsTxt? }: analyses sample pages of one pattern. */
export async function POST(request: Request) {
  const rejected = checkOrigin(request);
  if (rejected) return rejected;
  const body = await readJson(request);
  let origin: string;
  let patterns: string[];
  let urls: string[];
  const pattern = typeof body.pattern === "string" ? body.pattern.slice(0, 500) : "";
  try {
    origin = await parseOrigin(body.origin);
    patterns = parsePatterns(body.patterns);
    if (!pattern.startsWith("/")) throw new ValidationError("Send the pattern these pages belong to.");
    if (!Array.isArray(body.urls) || body.urls.length === 0) throw new ValidationError("Send at least one URL to analyse.");
    if (body.urls.length > MAX_URLS) throw new ValidationError(`Send at most ${MAX_URLS} URLs per request.`);
    const siteHost = new URL(origin).hostname;
    urls = body.urls.map((url) => parseSiteUrl(url, siteHost));
  } catch (err) {
    if (err instanceof ValidationError) return jsonError(err.message, 400);
    throw err;
  }

  try {
    const budget = new Budget();
    const siteHost = new URL(origin).hostname;
    // robots.txt comes from the site check when the browser has it; otherwise read it now.
    let robotsText = typeof body.robotsTxt === "string" ? body.robotsTxt.slice(0, 500_000) : null;
    if (robotsText === null) {
      const response = await fetchPage(`${origin}/robots.txt`, { budget, allowHost: (host) => sameSite(host, siteHost) });
      robotsText = !response.error && response.status === 200 && !/text\/html/i.test(response.headers["content-type"] ?? "") ? response.body : "";
    }
    const robots = parseRobots(robotsText, origin);
    const pages = await analyseUrls(urls, { pattern, patterns, robots, siteHost, budget });
    return NextResponse.json(fitResponse({ pattern, pages }));
  } catch (err) {
    console.error(err);
    const detail = err instanceof Error && err.message ? ` (${err.message})` : "";
    return jsonError(`Analysing ${pattern} failed unexpectedly${detail}. Try again in a minute.`, 500);
  }
}
