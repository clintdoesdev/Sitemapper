import { after, NextResponse } from "next/server";
import { getJobStatus, runSlice } from "@/lib/jobs";
import { jsonError } from "@/lib/request";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** A job's progress. Restarts its slices when they have stalled. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!getStore()) return jsonError("Background reading isn't set up on this server.", 501);
  const { id } = await params;
  try {
    const found = await getJobStatus(id);
    if (!found) return jsonError("This job link has expired or doesn't exist. Jobs are kept for 7 days.", 404);
    if (found.stalled) after(() => runSlice(id));
    return NextResponse.json(found.status, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(error);
    return jsonError("Couldn't read the job's progress. Try again in a minute.", 500);
  }
}
