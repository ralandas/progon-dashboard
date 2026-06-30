import { NextResponse } from "next/server";
import { syncReplies } from "@/lib/imap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Triggered by:
// - Vercel Cron (vercel.json schedule, every 10 min)
// - Manual button click in UI (POST)
async function handle(req: Request) {
  // Optional cron secret check — if CRON_SECRET is set, only Vercel cron with the matching
  // bearer is allowed. Manual POST from the UI bypasses this when the request originates
  // from our own Basic-auth-protected origin (middleware already validated that).
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization") || "";
    const isCron = auth === `Bearer ${cronSecret}`;
    const isManualFromUi = req.method === "POST";
    if (!isCron && !isManualFromUi) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const url = new URL(req.url);
  const sinceDays = Number(url.searchParams.get("sinceDays") || "14");

  const result = await syncReplies({ sinceDays });
  return NextResponse.json(result, {
    status: result.ok ? 200 : 500,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
