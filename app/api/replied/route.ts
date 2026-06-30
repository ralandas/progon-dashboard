import { NextResponse } from "next/server";
import { markReplied, unmarkReplied, listReplies } from "@/lib/replies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const replies = await listReplies();
  return NextResponse.json({ replies });
}

export async function POST(req: Request) {
  const { email, note } = (await req.json().catch(() => ({}))) as {
    email?: string;
    note?: string;
  };
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
  await markReplied(email, note);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const { email } = (await req.json().catch(() => ({}))) as { email?: string };
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
  await unmarkReplied(email);
  return NextResponse.json({ ok: true });
}
