import { NextResponse } from "next/server";
import { extractPages, MAX_EXTRACT_URLS } from "@/lib/extract";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  let urls: string[] = [];
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && "urls" in body && Array.isArray(body.urls)) {
      urls = body.urls.filter((url): url is string => typeof url === "string");
    }
  } catch {
    // Treated as an empty list below.
  }
  if (urls.length === 0) return error("Send at least one page URL to extract.", 400);
  if (urls.length > MAX_EXTRACT_URLS) {
    return error(`Send at most ${MAX_EXTRACT_URLS} URLs per request.`, 400);
  }

  try {
    return NextResponse.json({ pages: await extractPages(urls) });
  } catch (err) {
    console.error(err);
    const detail = err instanceof Error && err.message ? ` (${err.message})` : "";
    return error(`Extracting page contents failed unexpectedly${detail}. Try again in a minute.`, 500);
  }
}
