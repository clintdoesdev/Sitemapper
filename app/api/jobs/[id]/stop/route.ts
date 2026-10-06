import { NextResponse } from "next/server";
import { stopJob } from "@/lib/jobs";
import { checkOrigin, jsonError } from "@/lib/request";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const rejected = checkOrigin(request);
  if (rejected) return rejected;
  if (!getStore()) return jsonError("Background reading isn't set up on this server.", 501);
  const { id } = await params;
  try {
    if (!(await stopJob(id))) return jsonError("This job link has expired or doesn't exist.", 404);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(error);
    return jsonError("Couldn't stop the job. Try again in a minute.", 500);
  }
}
