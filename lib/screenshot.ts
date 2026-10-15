import type { Browser } from "puppeteer-core";
import { BROWSER_USER_AGENT } from "./fetcher";
import { checkHost } from "./guard";
import { isAllowedRequest } from "./render";

export type Device = "desktop" | "phone";

const VIEWPORTS: Record<Device, { width: number; height: number; isMobile: boolean; hasTouch: boolean }> = {
  desktop: { width: 1280, height: 800, isMobile: false, hasTouch: false },
  phone: { width: 390, height: 844, isMobile: true, hasTouch: true },
};
const PHONE_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36";

/** Taller pages are cut here; Chrome can't paint much more in one image. */
export const MAX_SHOT_HEIGHT = 15_000;
/** Kept under Vercel's 4.5 MB response limit once base64-encoded. */
const MAX_SHOT_BYTES = 3_000_000;
const NAVIGATION_TIMEOUT_MS = 20_000;

export type Shot =
  | { ok: true; url: string; finalUrl: string; status: number; width: number; height: number; truncated: boolean; image: Uint8Array }
  | { ok: false; url: string; error: string };

/**
 * Opens a page, scrolls to the bottom so lazy-loaded images and sections
 * appear, scrolls back up and takes one screenshot of the whole page.
 */
export async function screenshotPage(browser: Browser, url: string, device: Device, timeoutMs: number): Promise<Shot> {
  const started = Date.now();
  const left = () => timeoutMs - (Date.now() - started);
  const viewport = VIEWPORTS[device];
  const page = await browser.newPage();
  try {
    await page.setViewport({ ...viewport, deviceScaleFactor: 1 });
    await page.setUserAgent(device === "phone" ? PHONE_USER_AGENT : BROWSER_USER_AGENT);
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    await page.setRequestInterception(true);
    page.on("request", async (request) => {
      if (request.isInterceptResolutionHandled()) return;
      // Video and audio add nothing to a still image; everything else is needed to look right.
      if (request.resourceType() === "media" || !(await isAllowedRequest(request))) {
        request.abort().catch(() => undefined);
      } else {
        request.continue().catch(() => undefined);
      }
    });

    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: Math.max(2_000, Math.min(NAVIGATION_TIMEOUT_MS, left() - 8_000)),
    });
    await page.waitForNetworkIdle({ idleTime: 500, timeout: Math.min(5_000, Math.max(500, left() - 15_000)) }).catch(() => undefined);
    if (await checkHost(new URL(page.url()).hostname)) return { ok: false, url, error: "Redirected to a private address." };
    const status = response?.status() ?? 200;
    if (status >= 400) return { ok: false, url, error: `The page returned status ${status}.` };

    // Scroll down a screen at a time, then back to the top. Sent as text so
    // build tools can't add helpers to it that don't exist in the page.
    const scrollMs = Math.max(1_000, Math.min(12_000, left() - 12_000));
    await page.evaluate(`(async () => {
      const end = Date.now() + ${scrollMs};
      while (Date.now() < end) {
        window.scrollBy(0, Math.round(window.innerHeight * 0.85));
        await new Promise((resolve) => setTimeout(resolve, 200));
        const bottom = window.scrollY + window.innerHeight;
        if (bottom >= document.documentElement.scrollHeight - 2 || bottom >= ${MAX_SHOT_HEIGHT}) break;
      }
      window.scrollTo(0, 0);
    })()`);
    await page.waitForNetworkIdle({ idleTime: 400, timeout: Math.min(3_000, Math.max(300, left() - 8_000)) }).catch(() => undefined);

    const fullHeight = Number(
      await page.evaluate(
        "Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0, window.innerHeight)",
      ),
    );
    let height = Math.min(fullHeight, MAX_SHOT_HEIGHT);
    let image: Uint8Array | null = null;
    // Lower the quality, then the height, until the image is small enough to send.
    for (const quality of [70, 50, 35, 35, 35]) {
      image = await page.screenshot({
        type: "jpeg",
        quality,
        clip: { x: 0, y: 0, width: viewport.width, height },
        captureBeyondViewport: true,
      });
      if (image.byteLength <= MAX_SHOT_BYTES) break;
      if (quality === 35) height = Math.floor(height * 0.6);
      image = null;
    }
    if (!image) return { ok: false, url, error: "The screenshot was too large to send." };
    return { ok: true, url, finalUrl: page.url(), status, width: viewport.width, height, truncated: height < fullHeight, image };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return { ok: false, url, error: name === "TimeoutError" ? "Took too long to load in the browser." : "The browser couldn't load it." };
  } finally {
    await page.close().catch(() => undefined);
  }
}
