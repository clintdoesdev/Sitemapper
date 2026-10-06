/**
 * Read every page as a background job: the server reads the pages in slices
 * of under a minute, each slice starting the next, and keeps progress and
 * results in the store. The browser can close and check back with the job
 * link; nothing depends on it staying open.
 */
import { randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { extractPages, type ExtractResult } from "./contents";
import type { Identity } from "./fetcher";
import { getStore, type Store } from "./store";
import { parseOrigin, parseSiteUrl, ValidationError } from "./validate";

/** Most pages one job reads; starting another job continues with the rest. */
export const MAX_JOB_PAGES = 5_000;
/** Jobs and their results are kept this long, then deleted by the store. */
export const JOB_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Jobs reading at the same time, across everyone using this deployment. */
const MAX_ACTIVE_JOBS = 3;
/** A slice holds the lock this long; longer than a function can run, so a crashed slice frees it. */
const LOCK_MS = 70_000;
/** A running job not updated for this long has lost its slice and is restarted. */
export const STALE_MS = 90_000;
/** Jobs not updated for this long no longer count toward MAX_ACTIVE_JOBS. */
const ACTIVE_WINDOW_MS = 10 * 60 * 1000;
/** Time a step needs; with less left, the slice hands over to the next one. */
const MIN_STEP_MS = 12_000;
const HTML_BATCH = 60;
const HTML_CONCURRENCY = 18;
const RETRY_CHUNK = 5;
const RENDER_CHUNK = 4;
const MAX_PAUSE_MS = 60_000;
const MAX_ROBOTS_CHARS = 100_000;
const ITEM_BATCH = 500;
export const RESULTS_PAGE = 50;

export const JOB_ID = /^[A-Za-z0-9_-]{16}$/;

/** Starts the next slice. Injectable so tests run slices in-process. */
async function kickOverHttp(meta: JobMeta): Promise<void> {
  const headers: Record<string, string> = { "x-job-key": meta.key };
  // Lets the self-call through Vercel Deployment Protection when a bypass secret is set up.
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;
  try {
    const response = await fetch(`${meta.selfOrigin}/api/jobs/${meta.id}/run`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) console.error(`Job ${meta.id}: next slice answered ${response.status}`);
  } catch (error) {
    // The job is picked up again the next time someone checks its status.
    console.error(`Job ${meta.id}: couldn't start the next slice`, error);
  }
}

export const jobsConfig: {
  sliceMs: number;
  retryDelaysMs: number[];
  kick: (meta: JobMeta) => Promise<void>;
} = {
  sliceMs: 50_000,
  retryDelaysMs: [5_000, 15_000, 30_000],
  kick: kickOverHttp,
};

export type JobMeta = {
  id: string;
  /** Secret that only the server's own slice calls carry. */
  key: string;
  origin: string;
  host: string;
  identity: Identity;
  total: number;
  /** Matching pages left out because of the per-job limit. */
  skipped: number;
  createdAt: number;
  /** Where this app answers, for starting the next slice. */
  selfOrigin: string;
};

/**
 * One character per page, in item order: "." not read yet, "o" read, "s" read
 * but built by JavaScript, "r" failed for a temporary reason, "b" refused
 * (401/403), "x" failed for good.
 */
type Marks = string;

export type JobState = {
  status: "running" | "done" | "stopped" | "failed";
  phase: "html" | "retry" | "render" | "finished";
  cursor: number;
  done: number;
  marks: Marks;
  retry: { round: number; queue: number[]; total: number; done: number; at: number } | null;
  render: { queue: number[]; total: number; done: number } | null;
  pauseUntil: number;
  error: string | null;
  robotsTxt: Record<string, string>;
  updatedAt: number;
};

/** What the browser sees; never includes the key. */
export type JobStatus = {
  id: string;
  origin: string;
  host: string;
  identity: Identity;
  total: number;
  skipped: number;
  done: number;
  status: JobState["status"];
  rendering: { done: number; total: number } | null;
  retrying: { round: number; done: number; total: number } | null;
  failed: number;
  error: string | null;
  /** Entries in the results list; fetch from your last offset to get new ones. */
  results: number;
  createdAt: number;
  updatedAt: number;
};

const keys = (id: string) => ({
  meta: `job:${id}:meta`,
  state: `job:${id}:state`,
  items: `job:${id}:items`,
  results: `job:${id}:results`,
  order: `job:${id}:order`,
  lock: `job:${id}:lock`,
  stop: `job:${id}:stop`,
});
const ACTIVE = "jobs:active";

function randomId(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

/** Results are compressed: page text is most of the size and squeezes well. */
function encodeResult(page: ExtractResult): string {
  return gzipSync(JSON.stringify(page)).toString("base64");
}

function decodeResult(value: string): ExtractResult | null {
  try {
    return JSON.parse(gunzipSync(Buffer.from(value, "base64")).toString("utf8")) as ExtractResult;
  } catch {
    return null;
  }
}

function markFor(page: ExtractResult): string {
  if (page.ok) return page.needsRender ? "s" : "o";
  if (page.retryable) return "r";
  return page.blocked ? "b" : "x";
}

function indicesWith(marks: Marks, wanted: string): number[] {
  const found: number[] = [];
  for (let index = 0; index < marks.length; index++) if (wanted.includes(marks[index])) found.push(index);
  return found;
}

function countFailed(marks: Marks): number {
  let failed = 0;
  for (const mark of marks) if (mark === "r" || mark === "b" || mark === "x") failed++;
  return failed;
}

function requireStore(): Store {
  const store = getStore();
  if (!store) throw new ValidationError("Background reading isn't set up on this server.");
  return store;
}

async function readJson<T>(store: Store, key: string): Promise<T | null> {
  const value = await store.get(key);
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Creating, reading and stopping jobs
// ---------------------------------------------------------------------------

/** Validates the pages and stores a new job. Its first slice is started by the caller. */
export async function createJob(input: {
  origin: unknown;
  items: unknown;
  identity: unknown;
  skipped?: unknown;
  selfOrigin: string;
}): Promise<JobMeta> {
  const store = requireStore();
  const origin = await parseOrigin(input.origin);
  const host = new URL(origin).hostname;
  if (!Array.isArray(input.items) || input.items.length === 0) throw new ValidationError("Send at least one page to read.");
  if (input.items.length > MAX_JOB_PAGES) throw new ValidationError(`Send at most ${MAX_JOB_PAGES.toLocaleString("en-US")} pages per job.`);
  const seen = new Set<string>();
  const items: string[] = [];
  for (const item of input.items) {
    if (!Array.isArray(item)) throw new ValidationError("Each page must be [url, pattern].");
    const url = parseSiteUrl(item[0], host);
    const pattern = typeof item[1] === "string" && item[1].startsWith("/") ? item[1].slice(0, 500) : "/";
    if (seen.has(url)) continue;
    seen.add(url);
    items.push(`${url}\t${pattern}`);
  }

  const now = Date.now();
  let active = 0;
  for (const id of await store.smembers(ACTIVE)) {
    const state = await readJson<JobState>(store, keys(id).state);
    if (state?.status === "running" && now - state.updatedAt < ACTIVE_WINDOW_MS) active++;
    else await store.srem(ACTIVE, id);
  }
  if (active >= MAX_ACTIVE_JOBS) {
    throw new ValidationError(`Sitemapper is already reading pages for ${MAX_ACTIVE_JOBS} sites. Try again when one finishes.`);
  }

  const meta: JobMeta = {
    id: randomId(12),
    key: randomId(24),
    origin,
    host,
    identity: input.identity === "browser" ? "browser" : "bot",
    total: items.length,
    skipped: typeof input.skipped === "number" && input.skipped > 0 ? Math.floor(input.skipped) : 0,
    createdAt: now,
    selfOrigin: input.selfOrigin,
  };
  const state: JobState = {
    status: "running",
    phase: "html",
    cursor: 0,
    done: 0,
    marks: ".".repeat(items.length),
    retry: null,
    render: null,
    pauseUntil: 0,
    error: null,
    robotsTxt: {},
    updatedAt: now,
  };
  const k = keys(meta.id);
  for (let start = 0; start < items.length; start += ITEM_BATCH) await store.rpush(k.items, items.slice(start, start + ITEM_BATCH));
  await store.expire(k.items, JOB_TTL_MS);
  await store.set(k.meta, JSON.stringify(meta), { ttlMs: JOB_TTL_MS });
  await store.set(k.state, JSON.stringify(state), { ttlMs: JOB_TTL_MS });
  await store.sadd(ACTIVE, meta.id);
  return meta;
}

export async function getJobMeta(id: string): Promise<JobMeta | null> {
  if (!JOB_ID.test(id)) return null;
  return readJson<JobMeta>(requireStore(), keys(id).meta);
}

/** The job's progress, and whether its slices have stalled and need restarting. */
export async function getJobStatus(id: string): Promise<{ status: JobStatus; stalled: boolean } | null> {
  if (!JOB_ID.test(id)) return null;
  const store = requireStore();
  const k = keys(id);
  const [meta, state] = await Promise.all([readJson<JobMeta>(store, k.meta), readJson<JobState>(store, k.state)]);
  if (!meta || !state) return null;
  const [results, stopping] = await Promise.all([store.llen(k.order), store.get(k.stop)]);
  const running = state.status === "running" && !stopping;
  return {
    status: {
      id: meta.id,
      origin: meta.origin,
      host: meta.host,
      identity: meta.identity,
      total: meta.total,
      skipped: meta.skipped,
      done: state.done,
      status: state.status === "running" && stopping ? "stopped" : state.status,
      rendering: running && state.phase === "render" && state.render ? { done: state.render.done, total: state.render.total } : null,
      retrying:
        running && state.phase === "retry" && state.retry
          ? { round: state.retry.round + 1, done: state.retry.done, total: state.retry.total }
          : null,
      failed: countFailed(state.marks),
      error: state.error,
      results,
      createdAt: meta.createdAt,
      updatedAt: state.updatedAt,
    },
    stalled: running && Date.now() - state.updatedAt > STALE_MS,
  };
}

/** The job's pages and their patterns, in order. */
export async function getJobItems(id: string): Promise<{ origin: string; items: [string, string][] } | null> {
  const meta = await getJobMeta(id);
  if (!meta) return null;
  const lines = await requireStore().lrange(keys(id).items, 0, -1);
  return {
    origin: meta.origin,
    items: lines.map((line) => {
      const tab = line.indexOf("\t");
      return [line.slice(0, tab), line.slice(tab + 1)];
    }),
  };
}

/** Results written from `offset` on, oldest first. A page read twice appears twice; the later one wins. */
export async function getJobResults(id: string, offset: number): Promise<{ pages: ExtractResult[]; next: number } | null> {
  if (!JOB_ID.test(id)) return null;
  const store = requireStore();
  const k = keys(id);
  if (!(await store.get(k.meta))) return null;
  const start = Math.max(0, Math.floor(offset) || 0);
  const urls = await store.lrange(k.order, start, start + RESULTS_PAGE - 1);
  const unique = [...new Set(urls)];
  const values = await store.hmget(k.results, unique);
  const pages = values.map((value) => (value ? decodeResult(value) : null)).filter((page): page is ExtractResult => page !== null);
  return { pages, next: start + urls.length };
}

/** Asks the job to stop; the running slice finishes its current step first. */
export async function stopJob(id: string): Promise<boolean> {
  const meta = await getJobMeta(id);
  if (!meta) return false;
  const store = requireStore();
  const k = keys(id);
  await store.set(k.stop, "1", { ttlMs: JOB_TTL_MS });
  // When no slice is running, mark it stopped here.
  const token = randomId(8);
  if (await store.set(k.lock, token, { ttlMs: LOCK_MS, onlyIfMissing: true })) {
    try {
      const state = await readJson<JobState>(store, k.state);
      if (state?.status === "running") {
        state.status = "stopped";
        state.updatedAt = Date.now();
        await store.set(k.state, JSON.stringify(state), { ttlMs: JOB_TTL_MS });
      }
      await store.srem(ACTIVE, id);
    } finally {
      if ((await store.get(k.lock)) === token) await store.del(k.lock);
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Running a slice
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reads pages for up to `jobsConfig.sliceMs`, saving after every step, then
 * starts the next slice if the job isn't finished. Only one slice runs per job.
 */
export async function runSlice(id: string): Promise<void> {
  if (!JOB_ID.test(id)) return;
  const store = getStore();
  if (!store) return;
  const k = keys(id);
  const token = randomId(8);
  if (!(await store.set(k.lock, token, { ttlMs: LOCK_MS, onlyIfMissing: true }))) return;

  let meta: JobMeta | null = null;
  let state: JobState | null = null;
  let handOver = false;
  const save = async () => {
    if (!state) return;
    state.updatedAt = Date.now();
    await store.set(k.state, JSON.stringify(state), { ttlMs: JOB_TTL_MS });
  };

  try {
    [meta, state] = await Promise.all([readJson<JobMeta>(store, k.meta), readJson<JobState>(store, k.state)]);
    if (!meta || !state || state.status !== "running") return;
    const job = meta;
    const current = state;
    const items = (await store.lrange(k.items, 0, -1)).map((line) => line.slice(0, line.indexOf("\t")));
    const deadline = Date.now() + jobsConfig.sliceMs;
    const left = () => deadline - Date.now();

    const write = async (pages: ExtractResult[], indices: number[]) => {
      const fields: Record<string, string> = {};
      for (const page of pages) fields[page.url] = encodeResult(page);
      await store.hset(k.results, fields);
      await store.rpush(k.order, pages.map((page) => page.url));
      const marks = current.marks.split("");
      indices.forEach((index, position) => {
        if (pages[position]) marks[index] = markFor(pages[position]);
      });
      current.marks = marks.join("");
      const limited = pages.filter((page) => !page.ok && page.rateLimited);
      if (limited.length > 0) {
        const asked = Math.max(0, ...limited.map((page) => (!page.ok && page.retryAfter) || 0)) * 1000;
        current.pauseUntil = Math.max(current.pauseUntil, Date.now() + Math.min(asked > 0 ? asked : 10_000, MAX_PAUSE_MS));
      }
    };
    const read = (indices: number[], options: { gentle?: boolean; render?: boolean; concurrency?: number }) => {
      const robotsOut: Record<string, string> = {};
      return extractPages(
        indices.map((index) => items[index]),
        {
          ...options,
          identity: job.identity,
          robotsTxt: current.robotsTxt,
          robotsOut,
          budgetMs: Math.max(5_000, Math.min(40_000, left() - 5_000)),
        },
      ).then((pages) => {
        for (const [origin, text] of Object.entries(robotsOut)) current.robotsTxt[origin] = text.slice(0, MAX_ROBOTS_CHARS);
        return pages;
      });
    };
    const startRetry = (round: number) => {
      const queue = indicesWith(current.marks, "r");
      if (queue.length > 0 && round < jobsConfig.retryDelaysMs.length) {
        current.phase = "retry";
        current.retry = { round, queue, total: queue.length, done: 0, at: Date.now() + jobsConfig.retryDelaysMs[round] };
        return;
      }
      current.retry = null;
      startRender();
    };
    const startRender = () => {
      // Pages built by JavaScript get a second read in a browser, and so do
      // refused pages when requests are sent as a regular browser.
      const queue = indicesWith(current.marks, job.identity === "browser" ? "sb" : "s");
      if (queue.length > 0) {
        current.phase = "render";
        current.render = { queue, total: queue.length, done: 0 };
      } else finish();
    };
    const finish = () => {
      current.phase = "finished";
      current.render = null;
      current.status = "done";
    };

    while (current.status === "running") {
      if (await store.get(k.stop)) {
        current.status = "stopped";
        break;
      }
      const waitUntil = Math.max(current.pauseUntil, current.phase === "retry" && current.retry ? current.retry.at : 0);
      const waitMs = waitUntil - Date.now();
      if (waitMs > 0) {
        const nap = Math.min(waitMs, 5_000, left() - MIN_STEP_MS);
        if (nap <= 0) {
          handOver = true;
          break;
        }
        await sleep(nap);
        continue;
      }
      if (left() < MIN_STEP_MS) {
        handOver = true;
        break;
      }

      if (current.phase === "html") {
        const indices = Array.from({ length: Math.min(HTML_BATCH, job.total - current.cursor) }, (_, i) => current.cursor + i);
        if (indices.length > 0) {
          await write(await read(indices, { concurrency: HTML_CONCURRENCY }), indices);
          current.cursor += indices.length;
          current.done += indices.length;
        }
        if (current.cursor >= job.total) startRetry(0);
      } else if (current.phase === "retry" && current.retry) {
        const indices = current.retry.queue.slice(0, RETRY_CHUNK);
        await write(await read(indices, { gentle: true }), indices);
        current.retry.queue = current.retry.queue.slice(indices.length);
        current.retry.done += indices.length;
        if (current.retry.queue.length === 0) startRetry(current.retry.round + 1);
      } else if (current.phase === "render" && current.render) {
        const indices = current.render.queue.slice(0, RENDER_CHUNK);
        const urls = indices.map((index) => items[index]);
        let rendered: ExtractResult[];
        try {
          rendered = await read(indices, { render: true });
        } catch (error) {
          const message = `Running the page's JavaScript failed${error instanceof Error && error.message ? ` (${error.message})` : ""}.`;
          rendered = urls.map((url) => ({ url, ok: false as const, error: message }));
        }
        const before = await store.hmget(k.results, urls);
        const merged = rendered.map((page, position): ExtractResult => {
          const earlier = before[position] ? decodeResult(before[position]) : null;
          // Keep the HTML reading when the browser couldn't load the page.
          if (page.ok || !earlier?.ok) return page;
          return { ...earlier, renderError: page.error, needsRender: false };
        });
        await write(merged, indices);
        current.render.queue = current.render.queue.slice(indices.length);
        current.render.done += indices.length;
        if (current.render.queue.length === 0) finish();
      } else {
        finish();
      }
      await save();
    }
  } catch (error) {
    console.error(`Job ${id} failed`, error);
    if (state) {
      state.status = "failed";
      state.error = `Reading stopped unexpectedly${error instanceof Error && error.message ? ` (${error.message})` : ""}. Start it again to continue.`;
    }
  } finally {
    try {
      await save();
      await store.expire(k.results, JOB_TTL_MS);
      await store.expire(k.order, JOB_TTL_MS);
      if (state && state.status !== "running") await store.srem(ACTIVE, id);
    } finally {
      if ((await store.get(k.lock)) === token) await store.del(k.lock);
    }
  }
  if (handOver && meta && state?.status === "running") await jobsConfig.kick(meta);
}

/** The address this app answers on, for the self-calls that chain slices. */
export function selfOriginFor(request: Request): string {
  const url = new URL(request.url);
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host).split(",")[0].trim();
  const proto = (request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "")).split(",")[0].trim();
  if (!process.env.VERCEL) return `${proto === "https" ? "https" : "http"}://${host}`;
  // On Vercel, only call this deployment's own addresses, never a host taken on trust from a header.
  const known = [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL].filter(
    (value): value is string => Boolean(value),
  );
  if (known.includes(host)) return `https://${host}`;
  // Generated deployment URLs sit behind Deployment Protection; the production domain doesn't.
  const fallback =
    process.env.VERCEL_ENV === "production"
      ? process.env.VERCEL_PROJECT_PRODUCTION_URL
      : (process.env.VERCEL_BRANCH_URL ?? process.env.VERCEL_URL);
  return `https://${fallback ?? known[0] ?? host}`;
}
