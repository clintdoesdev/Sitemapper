import { NextResponse } from "next/server";
import { checkOrigin, jsonError, readJson } from "@/lib/request";
import { checkSite } from "@/lib/site";
import { parseOrigin, parsePatterns, parseSiteUrl, ValidationError } from "@/lib/validate";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** POST { origin, patterns (max 500), sampleUrl }: robots.txt, root files, host behaviour and the homepage. */
export async function POST(request: Request) {
  const rejected = checkOrigin(request);
  if (rejected) return rejected;
  const body = await readJson(request);
  let origin: string;
  let patterns: string[];
  let sampleUrl: string | null = null;
  try {
    origin = await parseOrigin(body.origin);
    patterns = parsePatterns(body.patterns);
    if (body.sampleUrl !== undefined && body.sampleUrl !== null && body.sampleUrl !== "") {
      sampleUrl = parseSiteUrl(body.sampleUrl, new URL(origin).hostname);
    }
  } catch (err) {
    if (err instanceof ValidationError) return jsonError(err.message, 400);
    throw err;
  }
  try {
    return NextResponse.json(await checkSite({ origin, patterns, sampleUrl }));
  } catch (err) {
    console.error(err);
    const detail = err instanceof Error && err.message ? ` (${err.message})` : "";
    return jsonError(`Checking ${new URL(origin).hostname} failed unexpectedly${detail}. Try again in a minute.`, 500);
  }
}
