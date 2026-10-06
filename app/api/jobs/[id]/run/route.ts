import { timingSafeEqual } from "node:crypto";
import { after, NextResponse } from "next/server";
import { getJobMeta, runSlice } from "@/lib/jobs";
import { jsonError } from "@/lib/request";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Runs the job's next slice. Only the server calls this, with the job's key. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!getStore()) return jsonError("Background reading isn't set up on this server.", 501);
  const { id } = await params;
  const meta = await getJobMeta(id);
  if (!meta) return jsonError("No such job.", 404);
  if (!sameSecret(request.headers.get("x-job-key") ?? "", meta.key)) return jsonError("Not allowed.", 403);
  after(() => runSlice(id));
  return NextResponse.json({ ok: true }, { status: 202 });
}
