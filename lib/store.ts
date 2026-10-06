/**
 * A small key-value store for background jobs: Upstash Redis over its REST
 * API in production, an in-memory map for local development and tests.
 */

export type Store = {
  get(key: string): Promise<string | null>;
  /** With `onlyIfMissing`, sets nothing and returns false when the key exists. */
  set(key: string, value: string, options?: { ttlMs?: number; onlyIfMissing?: boolean }): Promise<boolean>;
  del(...keys: string[]): Promise<void>;
  expire(key: string, ttlMs: number): Promise<void>;
  hset(key: string, fields: Record<string, string>): Promise<void>;
  hmget(key: string, fields: string[]): Promise<(string | null)[]>;
  rpush(key: string, values: string[]): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  llen(key: string): Promise<number>;
  sadd(key: string, member: string): Promise<void>;
  srem(key: string, member: string): Promise<void>;
  smembers(key: string): Promise<string[]>;
};

// ---------------------------------------------------------------------------
// Upstash Redis (REST)
// ---------------------------------------------------------------------------

type Command = (string | number)[];

function upstashEnv(): { url: string; token: string } | null {
  // Vercel's Upstash integration sets the KV_ names; Upstash's own console uses the UPSTASH_ names.
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
}

export function upstashStore(url: string, token: string): Store {
  const send = async (path: string, body: unknown): Promise<unknown> => {
    const response = await fetch(`${url}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await response.json().catch(() => null)) as { result?: unknown; error?: string } | null;
    if (!response.ok || !data || data.error) {
      throw new Error(`Storage error: ${data?.error ?? `status ${response.status}`}`);
    }
    return data.result;
  };
  const run = (command: Command) => send("", command);

  return {
    get: async (key) => (await run(["GET", key])) as string | null,
    set: async (key, value, options = {}) => {
      const command: Command = ["SET", key, value];
      if (options.ttlMs) command.push("PX", Math.max(1, Math.round(options.ttlMs)));
      if (options.onlyIfMissing) command.push("NX");
      return (await run(command)) === "OK";
    },
    del: async (...keys) => {
      if (keys.length) await run(["DEL", ...keys]);
    },
    expire: async (key, ttlMs) => {
      await run(["PEXPIRE", key, Math.round(ttlMs)]);
    },
    hset: async (key, fields) => {
      const entries = Object.entries(fields);
      if (entries.length) await run(["HSET", key, ...entries.flat()]);
    },
    hmget: async (key, fields) => (fields.length ? ((await run(["HMGET", key, ...fields])) as (string | null)[]) : []),
    rpush: async (key, values) => (values.length ? Number(await run(["RPUSH", key, ...values])) : 0),
    lrange: async (key, start, stop) => (await run(["LRANGE", key, start, stop])) as string[],
    llen: async (key) => Number(await run(["LLEN", key])),
    sadd: async (key, member) => {
      await run(["SADD", key, member]);
    },
    srem: async (key, member) => {
      await run(["SREM", key, member]);
    },
    smembers: async (key) => (await run(["SMEMBERS", key])) as string[],
  };
}

// ---------------------------------------------------------------------------
// In memory (one process only)
// ---------------------------------------------------------------------------

export function memoryStore(): Store {
  type Entry = { value: string | Map<string, string> | string[] | Set<string>; expires: number };
  const data = new Map<string, Entry>();
  const read = <T extends Entry["value"]>(key: string): T | undefined => {
    const entry = data.get(key);
    if (!entry) return undefined;
    if (entry.expires && entry.expires <= Date.now()) {
      data.delete(key);
      return undefined;
    }
    return entry.value as T;
  };
  const write = (key: string, value: Entry["value"]) => {
    const expires = data.get(key)?.expires ?? 0;
    data.set(key, { value, expires });
  };

  return {
    get: async (key) => {
      const value = read<string>(key);
      return typeof value === "string" ? value : null;
    },
    set: async (key, value, options = {}) => {
      if (options.onlyIfMissing && read(key) !== undefined) return false;
      data.set(key, { value, expires: options.ttlMs ? Date.now() + options.ttlMs : 0 });
      return true;
    },
    del: async (...keys) => {
      for (const key of keys) data.delete(key);
    },
    expire: async (key, ttlMs) => {
      const entry = data.get(key);
      if (entry) entry.expires = Date.now() + ttlMs;
    },
    hset: async (key, fields) => {
      const hash = read<Map<string, string>>(key) ?? new Map<string, string>();
      for (const [field, value] of Object.entries(fields)) hash.set(field, value);
      write(key, hash);
    },
    hmget: async (key, fields) => {
      const hash = read<Map<string, string>>(key);
      return fields.map((field) => hash?.get(field) ?? null);
    },
    rpush: async (key, values) => {
      const list = read<string[]>(key) ?? [];
      list.push(...values);
      write(key, list);
      return list.length;
    },
    lrange: async (key, start, stop) => {
      const list = read<string[]>(key) ?? [];
      return list.slice(start, stop < 0 ? list.length + stop + 1 : stop + 1);
    },
    llen: async (key) => (read<string[]>(key) ?? []).length,
    sadd: async (key, member) => {
      const set = read<Set<string>>(key) ?? new Set<string>();
      set.add(member);
      write(key, set);
    },
    srem: async (key, member) => {
      read<Set<string>>(key)?.delete(member);
    },
    smembers: async (key) => [...(read<Set<string>>(key) ?? [])],
  };
}

// ---------------------------------------------------------------------------

/** Injectable so tests can use a fresh in-memory store. */
export const storeConfig: { store: Store | null | undefined } = { store: undefined };

// Kept on globalThis so the dev server's module reloads don't lose running jobs.
const globalMemory = globalThis as typeof globalThis & { __sitemapperMemoryStore?: Store };

/**
 * The store background jobs use, or null when none is set up: on Vercel,
 * jobs need Upstash, because each request may run on a different machine.
 */
export function getStore(): Store | null {
  if (storeConfig.store !== undefined) return storeConfig.store;
  const env = upstashEnv();
  if (env) return upstashStore(env.url, env.token);
  if (process.env.VERCEL) return null;
  globalMemory.__sitemapperMemoryStore ??= memoryStore();
  return globalMemory.__sitemapperMemoryStore;
}
