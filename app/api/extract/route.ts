import { NextResponse } from "next/server";
import { checkOrigin } from "@/lib/request";
import type { Identity } from "@/lib/crawl";
import { extractPages, MAX_EXTRACT_URLS, MAX_RENDER_URLS } from "@/lib/contents";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const rejected = checkOrigin(request);
  if (rejected) return rejected;
  let urls: string[] = [];
  let render = false;
  let gentle = false;
  let identity: Identity = "bot";
  let robotsTxt: Record<string, string> | undefined;
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && "urls" in body && Array.isArray(body.urls)) {
      urls = body.urls.filter((url): url is string => typeof url === "string");
    }
    if (body && typeof body === "object" && "render" in body) render = body.render === true;
    if (body && typeof body === "object" && "gentle" in body) gentle = body.gentle === true;
    if (body && typeof body === "object" && "identity" in body && body.identity === "browser") identity = "browser";
    if (body && typeof body === "object" && "robotsTxt" in body && body.robotsTxt && typeof body.robotsTxt === "object") {
      robotsTxt = Object.fromEntries(
        Object.entries(body.robotsTxt as Record<string, unknown>)
          .filter((entry): entry is [string, string] => typeof entry[1] === "string")
          .slice(0, 10)
          .map(([origin, text]) => [origin, text.slice(0, 100_000)]),
      );
    }
  } catch {
    // Treated as an empty list below.
  }
  if (urls.length === 0) return error("Send at least one page URL to extract.", 400);
  const limit = render ? MAX_RENDER_URLS : MAX_EXTRACT_URLS;
  if (urls.length > limit) {
    return error(`Send at most ${limit} URLs per request${render ? " when rendering JavaScript" : ""}.`, 400);
  }

  try {
    const robotsOut: Record<string, string> = {};
    const pages = await extractPages(urls, { render, gentle, identity, robotsTxt, robotsOut });
    return NextResponse.json({ pages, robotsTxt: robotsOut });
  } catch (err) {
    console.error(err);
    const detail = err instanceof Error && err.message ? ` (${err.message})` : "";
    const action = render ? "Rendering pages with JavaScript" : "Extracting page contents";
    return error(`${action} failed unexpectedly${detail}. Try again in a minute.`, 500);
  }
}
