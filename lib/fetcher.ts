import { gunzipSync, constants as zlibConstants } from "node:zlib";
import { checkHost } from "./guard";

/**
 * How requests identify themselves. "bot" announces Sitemapper; "browser"
 * sends the user agent and headers of a regular desktop Chrome. Only the
 * existing map and extract features offer "browser"; site checks and page
 * analysis always use "bot".
 */
export type Identity = "bot" | "browser";

export const BOT_USER_AGENT = "SitemapperBot/1.0 (site structure study tool)";
export const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

export function userAgentFor(identity: Identity): string {
  return identity === "browser" ? BROWSER_USER_AGENT : BOT_USER_AGENT;
}

export const REQUEST_TIMEOUT_MS = 10_000;
export const TIME_BUDGET_MS = 50_000;
/** Pages stop being read at this size and are marked truncated. */
export const MAX_PAGE_BYTES = 3 * 1024 * 1024;
const MAX_HOPS = 5;

export const BOT_PROTECTION_MESSAGE = (url: string) =>
  `Blocked by bot protection. Open view-source:${url} in a browser to study it manually.`;

/** A shared deadline, and identity, for every request made while handling one API call. */
export class Budget {
  private readonly deadline: number;
  readonly identity: Identity;

  constructor(ms: number = TIME_BUDGET_MS, identity: Identity = "bot") {
    this.deadline = Date.now() + ms;
    this.identity = identity;
  }

  remaining(): number {
    return this.deadline - Date.now();
  }

  expired(): boolean {
    return this.remaining() <= 0;
  }
}

/** Injectable so tests can run offline. */
export const fetcherConfig: { fetch: typeof fetch } = {
  fetch: (input, init) => fetch(input, init),
};

export type RedirectHop = { url: string; status: number; location: string };

export type FetchErrorKind = "timeout" | "network" | "private" | "too-many-redirects" | "invalid-url";

export type FetchResult = {
  /** The URL that was asked for. */
  url: string;
  /** Where the last request went (after redirects that were followed). */
  finalUrl: string;
  /** 0 when no response was received. */
  status: number;
  headers: Record<string, string>;
  body: string;
  redirectChain: RedirectHop[];
  ms: number;
  bytes: number;
  truncated: boolean;
  /** True when the response looks like a bot-protection challenge. */
  blocked: boolean;
  error: string | null;
  errorKind: FetchErrorKind | null;
  /** A redirect that left the allowed host. Recorded, not followed. */
  offHostRedirect: string | null;
  /** Seconds the site asked us to wait, from a Retry-After header. */
  retryAfter: number | null;
};

export type FetchOptions = {
  budget?: Budget;
  /** Accept header preset. */
  accept?: "html" | "any";
  maxBytes?: number;
  /** When set, redirect hops to hosts this rejects are recorded, not followed. */
  allowHost?: (hostname: string) => boolean;
  method?: "GET" | "HEAD";
};

function headersFor(identity: Identity, accept: "html" | "any"): Record<string, string> {
  const asBrowser = identity === "browser";
  const headers: Record<string, string> = {
    "User-Agent": userAgentFor(identity),
    Accept:
      accept === "html" || asBrowser
        ? "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
        : "*/*",
    "Accept-Language": asBrowser ? "en-US,en;q=0.9" : "en;q=0.9,*;q=0.5",
  };
  if (asBrowser) {
    headers["Upgrade-Insecure-Requests"] = "1";
    headers["Sec-Fetch-Dest"] = "document";
    headers["Sec-Fetch-Mode"] = "navigate";
    headers["Sec-Fetch-Site"] = "none";
  }
  return headers;
}

export function parseRetryAfter(value: string | null | undefined): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, (date - Date.now()) / 1000);
}

function charsetOf(contentType: string): string {
  const match = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType);
  return match ? match[1].toLowerCase() : "utf-8";
}

function decode(bytes: Uint8Array, contentType: string): string {
  try {
    return new TextDecoder(charsetOf(contentType)).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** Reads a response body up to `maxBytes`, then stops and reports truncation. */
async function readCapped(response: Response, maxBytes: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  if (!response.body) return { bytes: new Uint8Array(0), truncated: false };
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.length > maxBytes) {
      parts.push(value.subarray(0, maxBytes - total));
      total = maxBytes;
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
    parts.push(value);
    total += value.length;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return { bytes, truncated };
}

function gunzipIfNeeded(bytes: Uint8Array, maxBytes: number): { bytes: Uint8Array; truncated: boolean } {
  if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return { bytes, truncated: false };
  try {
    const out = gunzipSync(bytes, { maxOutputLength: maxBytes * 20, finishFlush: zlibConstants.Z_SYNC_FLUSH });
    return { bytes: new Uint8Array(out), truncated: false };
  } catch {
    return { bytes, truncated: true };
  }
}

/** Detects bot-protection challenges (Cloudflare and similar). */
export function looksLikeBotProtection(status: number, headers: Record<string, string>, body: string): boolean {
  const head = body.slice(0, 20_000);
  if ((status === 403 || status === 503) && headers["cf-mitigated"]) return true;
  if (/<title>\s*Just a moment\.\.\.\s*<\/title>/i.test(head)) return true;
  if (/challenge-platform|cf-challenge|_cf_chl_opt|cf_chl_prog/i.test(head) && (status === 403 || status === 503 || status === 429 || /<title>\s*(?:Attention Required|Just a moment)/i.test(head))) {
    return true;
  }
  return false;
}

/**
 * Fetches a URL with manual, guarded redirects: at most 5 hops, every hop
 * checked against the SSRF guard (including DNS), relative Location headers
 * resolved. Bodies stop at maxBytes (3 MB by default) and are decoded with
 * the charset from Content-Type.
 */
export async function fetchPage(url: string, options: FetchOptions = {}): Promise<FetchResult> {
  const budget = options.budget ?? new Budget(REQUEST_TIMEOUT_MS);
  const maxBytes = options.maxBytes ?? MAX_PAGE_BYTES;
  const started = Date.now();
  const result: FetchResult = {
    url,
    finalUrl: url,
    status: 0,
    headers: {},
    body: "",
    redirectChain: [],
    ms: 0,
    bytes: 0,
    truncated: false,
    blocked: false,
    error: null,
    errorKind: null,
    offHostRedirect: null,
    retryAfter: null,
  };
  const fail = (kind: FetchErrorKind, message: string) => {
    result.errorKind = kind;
    result.error = message;
    result.ms = Date.now() - started;
    return result;
  };

  const timeout = Math.min(REQUEST_TIMEOUT_MS, budget.remaining());
  if (timeout <= 0) return fail("timeout", "Ran out of time before this request.");
  const signal = AbortSignal.timeout(timeout);
  const headers = headersFor(budget.identity, options.accept ?? "any");

  let current = url;
  for (let hop = 0; ; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      return fail("invalid-url", "Not a valid URL.");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return fail("invalid-url", "Not an http(s) URL.");
    const reason = await checkHost(parsed.hostname);
    if (reason) return fail("private", reason);
    result.finalUrl = current;

    let response: Response;
    try {
      response = await fetcherConfig.fetch(current, {
        method: options.method ?? "GET",
        headers,
        redirect: "manual",
        cache: "no-store",
        signal,
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      return name === "TimeoutError" || name === "AbortError"
        ? fail("timeout", "Took longer than 10 seconds to respond.")
        : fail("network", "The connection failed.");
    }

    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      await response.body?.cancel().catch(() => undefined);
      let next: string;
      try {
        next = new URL(location, current).href;
      } catch {
        return fail("invalid-url", `Redirected to an invalid address (${location}).`);
      }
      result.redirectChain.push({ url: current, status: response.status, location: next });
      if (options.allowHost && !options.allowHost(new URL(next).hostname)) {
        // Record where it wanted to go, but don't leave the site.
        result.status = response.status;
        result.headers = Object.fromEntries(response.headers);
        result.offHostRedirect = next;
        result.ms = Date.now() - started;
        return result;
      }
      if (hop + 1 >= MAX_HOPS) return fail("too-many-redirects", `More than ${MAX_HOPS} redirects.`);
      current = next;
      continue;
    }

    result.status = response.status;
    result.headers = Object.fromEntries(response.headers);
    result.retryAfter = parseRetryAfter(response.headers.get("retry-after"));
    try {
      const read = await readCapped(response, maxBytes);
      const unzipped = gunzipIfNeeded(read.bytes, maxBytes);
      result.bytes = read.bytes.length;
      result.truncated = read.truncated || unzipped.truncated;
      result.body = decode(unzipped.bytes, result.headers["content-type"] ?? "");
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "TimeoutError" || name === "AbortError") return fail("timeout", "Took longer than 10 seconds to respond.");
      return fail("network", "The connection dropped while reading the page.");
    }
    result.blocked = looksLikeBotProtection(result.status, result.headers, result.body);
    result.ms = Date.now() - started;
    return result;
  }
}

/** Runs `work` over items in batches of `size`, pausing between batches. */
export async function inBatches<T, R>(
  items: T[],
  size: number,
  pauseMs: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  for (let start = 0; start < items.length; start += size) {
    const batch = items.slice(start, start + size);
    const done = await Promise.all(batch.map((item, offset) => work(item, start + offset)));
    done.forEach((value, offset) => (results[start + offset] = value));
    if (start + size < items.length && pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
  }
  return results;
}

// ---------------------------------------------------------------------------
// Compatibility wrapper used by the map and extract features
// ---------------------------------------------------------------------------

type FetchOk = {
  ok: true;
  url: string;
  status: number;
  contentType: string;
  text: string;
  retryAfter: number | null;
  /** True when the response is a bot-protection challenge. */
  botProtection: boolean;
};
type FetchFail = { ok: false; reason: "network" | "timeout" | "blocked" };
export type FetchOutcome = FetchOk | FetchFail;

export async function fetchText(
  url: string,
  budget: Budget,
  options: { html?: boolean; maxBytes?: number } = {},
): Promise<FetchOutcome> {
  const response = await fetchPage(url, {
    budget,
    accept: options.html ? "html" : "any",
    maxBytes: options.maxBytes ?? MAX_PAGE_BYTES,
  });
  if (response.errorKind) {
    return {
      ok: false,
      reason:
        response.errorKind === "timeout" ? "timeout" : response.errorKind === "private" ? "blocked" : "network",
    };
  }
  return {
    ok: true,
    url: response.finalUrl,
    status: response.status,
    contentType: response.headers["content-type"] ?? "",
    text: response.body,
    retryAfter: response.retryAfter,
    botProtection: response.blocked,
  };
}
