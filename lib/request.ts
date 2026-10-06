import { NextResponse } from "next/server";

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Rejects cross-site calls: when an Origin header is present, its host must
 * be this app's own host. Requests without Origin (same-origin GETs, curl)
 * pass.
 */
export function checkOrigin(request: Request): NextResponse | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  let originHost = "";
  try {
    originHost = new URL(origin).host;
  } catch {
    return jsonError("Requests from other sites aren't accepted.", 403);
  }
  if (!host || originHost.toLowerCase() !== host.split(",")[0].trim().toLowerCase()) {
    return jsonError("Requests from other sites aren't accepted.", 403);
  }
  return null;
}

/** Parses a JSON body, returning an empty object when it isn't valid JSON. */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
