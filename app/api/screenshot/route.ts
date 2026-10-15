import { NextResponse } from "next/server";
import { isAffiliatePath } from "@/lib/affiliate";
import { loadRobotsText } from "@/lib/contents";
import { Budget } from "@/lib/fetcher";
import { checkHost } from "@/lib/guard";
import { withBrowser } from "@/lib/render";
import { checkOrigin, jsonError, readJson } from "@/lib/request";
import { parseRobots } from "@/lib/robots";
import { screenshotPage, type Device } from "@/lib/screenshot";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Screenshots one page: `POST { url, device, robotsTxt }`. Returns the JPEG as
 * base64, plus the robots.txt text when it had to be fetched, for the next call.
 */
export async function POST(request: Request) {
  const rejected = checkOrigin(request);
  if (rejected) return rejected;
  const body = await readJson(request);
  let url: URL;
  try {
    url = new URL(String(body.url ?? ""));
  } catch {
    return jsonError("Send the URL of the page to screenshot.", 400);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return jsonError("Only http and https pages can be screenshotted.", 400);
  const device: Device = body.device === "phone" ? "phone" : "desktop";
  const page = url.href;

  const blocked = await checkHost(url.hostname);
  if (blocked) return NextResponse.json({ ok: false, url: page, error: blocked });
  if (isAffiliatePath(page)) return NextResponse.json({ ok: false, url: page, error: "Affiliate redirect path: recorded, not requested." });

  const known = body.robotsTxt && typeof body.robotsTxt === "object" ? (body.robotsTxt as Record<string, unknown>)[url.origin] : undefined;
  const robotsTxt = typeof known === "string" ? known : await loadRobotsText(url.origin, new Budget(10_000));
  const robotsOut = typeof known === "string" ? {} : { [url.origin]: robotsTxt };
  if (!parseRobots(robotsTxt, url.origin).isAllowed(page)) {
    return NextResponse.json({ ok: false, url: page, error: "Blocked by the site's robots.txt.", robotsTxt: robotsOut });
  }

  try {
    const shot = await withBrowser((browser) => screenshotPage(browser, page, device, 50_000));
    if (!shot.ok) return NextResponse.json({ ...shot, robotsTxt: robotsOut });
    const { image, ...rest } = shot;
    return NextResponse.json({ ...rest, image: Buffer.from(image).toString("base64"), robotsTxt: robotsOut });
  } catch (error) {
    console.error(error);
    const detail = error instanceof Error && error.message ? ` (${error.message})` : "";
    return jsonError(`The browser couldn't start${detail}. Try again in a minute.`, 500);
  }
}
