import { NextResponse } from "next/server";
import { getJobResults } from "@/lib/jobs";
import { jsonError } from "@/lib/request";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Results from ?offset= on, oldest first; pass `next` back as the offset for newer ones. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!getStore()) return jsonError("Background reading isn't set up on this server.", 501);
  const { id } = await params;
  const offset = Number(new URL(request.url).searchParams.get("offset") ?? 0);
  try {
    const results = await getJobResults(id, offset);
    if (!results) return jsonError("This job link has expired or doesn't exist.", 404);
    return NextResponse.json(results, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(error);
    return jsonError("Couldn't read the job's results. Try again in a minute.", 500);
  }
}
