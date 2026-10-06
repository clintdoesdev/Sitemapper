import { after, NextResponse } from "next/server";
import { createJob, runSlice, selfOriginFor } from "@/lib/jobs";
import { checkOrigin, jsonError, readJson } from "@/lib/request";
import { getStore } from "@/lib/store";
import { ValidationError } from "@/lib/validate";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Whether background jobs are available on this server. */
export async function GET() {
  return NextResponse.json({ enabled: getStore() !== null });
}

/** Starts reading pages in the background: { origin, items: [url, pattern][], identity, skipped }. */
export async function POST(request: Request) {
  const rejected = checkOrigin(request);
  if (rejected) return rejected;
  if (!getStore()) return jsonError("Background reading isn't set up on this server.", 501);
  const body = await readJson(request);
  try {
    const meta = await createJob({ ...body, selfOrigin: selfOriginFor(request) } as Parameters<typeof createJob>[0]);
    after(() => runSlice(meta.id));
    return NextResponse.json({ id: meta.id }, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) return jsonError(error.message, 400);
    console.error(error);
    return jsonError("Couldn't start reading in the background. Try again in a minute.", 500);
  }
}
