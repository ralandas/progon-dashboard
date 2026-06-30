import { NextResponse } from "next/server";
import { pickRetryRecipients, runRetryBroadcast, listRetryHistory } from "@/lib/broadcast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// GET → preview: how many would be sent, history of past retries.
export async function GET() {
  const [preview, history] = await Promise.all([pickRetryRecipients(), listRetryHistory()]);
  return NextResponse.json(
    { preview, history },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}

// POST → execute. Body: { dryRun?: boolean, subject?: string, delayMs?: number, confirm: "RETRY-BROADCAST" }
// confirm is required to prevent accidental fires.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    dryRun?: boolean;
    subject?: string;
    delayMs?: number;
    confirm?: string;
  };

  if (body.confirm !== "RETRY-BROADCAST") {
    return NextResponse.json(
      { error: "missing confirm token. Pass confirm: 'RETRY-BROADCAST' to execute." },
      { status: 400 },
    );
  }

  const result = await runRetryBroadcast({
    dryRun: body.dryRun,
    delayMs: body.delayMs,
    subject: body.subject,
  });
  return NextResponse.json(result, {
    status: result.ok ? 200 : 500,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
