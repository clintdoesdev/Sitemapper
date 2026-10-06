import { NextResponse } from "next/server";
import { getJobItems } from "@/lib/jobs";
import { jsonError } from "@/lib/request";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The job's pages and their URL patterns, to rebuild the page list from a job link. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!getStore()) return jsonError("Background reading isn't set up on this server.", 501);
  const { id } = await params;
  try {
    const found = await getJobItems(id);
    if (!found) return jsonError("This job link has expired or doesn't exist.", 404);
    return NextResponse.json(found);
  } catch (error) {
    console.error(error);
    return jsonError("Couldn't read the job's pages. Try again in a minute.", 500);
  }
}
