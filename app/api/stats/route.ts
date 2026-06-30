import { NextResponse } from "next/server";
import recipients from "@/data/recipients.json";
import { fetchManyResendStatuses } from "@/lib/resend";
import { listReplies } from "@/lib/replies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Recipient = { i: number; to: string; resend_id: string | null; status: string };

export async function GET() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "RESEND_API_KEY not set" }, { status: 500 });
  }

  const recs = recipients as Recipient[];
  const idsToFetch = recs.map((r) => r.resend_id).filter((x): x is string => !!x);

  const [statuses, replies] = await Promise.all([
    fetchManyResendStatuses(idsToFetch, apiKey),
    listReplies(),
  ]);

  const rows = recs.map((r) => {
    const ev = r.resend_id ? statuses[r.resend_id] : null;
    const replyInfo = replies[r.to.toLowerCase()];
    const lastEvent = ev?.last_event ?? (r.resend_id ? "unknown" : "quota_failed");
    return {
      i: r.i,
      to: r.to,
      domain: r.to.split("@")[1] ?? "",
      resend_id: r.resend_id,
      status: r.status,
      last_event: lastEvent,
      created_at: ev?.created_at ?? null,
      replied: !!replyInfo,
      replied_at: replyInfo?.repliedAt ?? null,
      replied_note: replyInfo?.note ?? null,
    };
  });

  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.last_event] = (acc[r.last_event] ?? 0) + 1;
    return acc;
  }, {});

  const summary = {
    total: rows.length,
    sent: rows.filter((r) => r.resend_id).length,
    delivered: counts.delivered ?? 0,
    bounced: counts.bounced ?? 0,
    opened: counts.opened ?? 0,
    clicked: counts.clicked ?? 0,
    complained: counts.complained ?? 0,
    delayed: counts.delivery_delayed ?? 0,
    sent_only: counts.sent ?? 0,
    quota_failed: counts.quota_failed ?? 0,
    unknown: counts.unknown ?? 0,
    replied: rows.filter((r) => r.replied).length,
  };

  return NextResponse.json(
    { summary, rows, fetchedAt: new Date().toISOString() },
    {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    },
  );
}
