import type { Browser, HTTPRequest } from "puppeteer-core";
import { blockedHostReason, userAgentFor, type Identity } from "./crawl";
const NAVIGATION_TIMEOUT_MS = 15_000;
const SETTLE_TIMEOUT_MS = 4_000;
const SKIPPED_RESOURCES = new Set(["image", "media", "font", "stylesheet"]);

/** Extra Chromium flags, used by local tests to map test hostnames. */
export const renderConfig = { extraArgs: [] as string[] };

export type RenderedPage =
  | { ok: true; url: string; status: number; html: string }
  | { ok: false; error: string };

const LOCAL_CHROME_PATHS: Record<string, string[]> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ],
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ],
  linux: ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"],
};

async function launchOptions(): Promise<{ executablePath: string; args: string[] }> {
  const { existsSync } = await import("node:fs");
  const baseArgs = ["--no-sandbox", "--disable-dev-shm-usage", ...renderConfig.extraArgs];

  // Local development: CHROME_PATH or an installed Chrome. Not needed on Vercel.
  const local = [process.env.CHROME_PATH, ...(LOCAL_CHROME_PATHS[process.platform] ?? [])].find(
    (path): path is string => Boolean(path && existsSync(path)),
  );
  if (local && !process.env.VERCEL) return { executablePath: local, args: baseArgs };

  if (process.platform !== "linux") {
    throw new Error("Rendering JavaScript locally needs Google Chrome installed, or CHROME_PATH set.");
  }
  // On Vercel (and other Linux hosts) use the serverless Chromium build.
  const chromium = (await import("@sparticuz/chromium")).default;
  return {
    executablePath: await chromium.executablePath(),
    args: [...chromium.args, ...renderConfig.extraArgs],
  };
}

/** Starts a headless browser, runs `work`, and always closes the browser. */
export async function withBrowser<T>(work: (browser: Browser) => Promise<T>): Promise<T> {
  const puppeteer = (await import("puppeteer-core")).default;
  const browser = await puppeteer.launch({ ...(await launchOptions()), headless: true });
  try {
    return await work(browser);
  } finally {
    await browser.close().catch(() => undefined);
  }
}

function isAllowedRequest(request: HTTPRequest): boolean {
  const url = request.url();
  if (url.startsWith("data:") || url.startsWith("blob:")) return true;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    // The page's own scripts must not reach private or local addresses either.
    return !blockedHostReason(parsed.hostname);
  } catch {
    return false;
  }
}

/** Loads a page in the browser, lets its JavaScript run, and returns the resulting HTML. */
export async function renderPage(
  browser: Browser,
  url: string,
  timeoutMs: number,
  identity: Identity = "bot",
): Promise<RenderedPage> {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(userAgentFor(identity));
    if (identity === "browser") await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (request.isInterceptResolutionHandled()) return;
      if (!isAllowedRequest(request) || SKIPPED_RESOURCES.has(request.resourceType())) {
        request.abort().catch(() => undefined);
      } else {
        request.continue().catch(() => undefined);
      }
    });

    const navigationTimeout = Math.max(1_000, Math.min(NAVIGATION_TIMEOUT_MS, timeoutMs));
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: navigationTimeout });
    // Give client-side code a moment to fetch data and render.
    await page
      .waitForNetworkIdle({ idleTime: 500, timeout: Math.min(SETTLE_TIMEOUT_MS, Math.max(500, timeoutMs / 3)) })
      .catch(() => undefined);

    const finalUrl = page.url();
    if (blockedHostReason(new URL(finalUrl).hostname)) {
      return { ok: false, error: "Redirected to a private address." };
    }
    const status = response?.status() ?? 200;
    if (status >= 400) return { ok: false, error: `Returned status ${status}.` };
    return { ok: true, url: finalUrl, status, html: await page.content() };
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return {
      ok: false,
      error: name === "TimeoutError" ? "Took too long to load in the browser." : "The browser couldn't load it.",
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}
