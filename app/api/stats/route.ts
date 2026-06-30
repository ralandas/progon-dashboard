import { NextResponse } from "next/server";
import recipients from "@/data/recipients.json";
import { fetchManyResendStatuses, type ResendEmail } from "@/lib/resend";
import { listReplies } from "@/lib/replies";
import { loadSticky, mergeSticky, rank, type StickyEntry } from "@/lib/sticky";
import { hasRedis } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Recipient = { i: number; to: string; resend_id: string | null; status: string };

// Short-lived response cache so refreshing rapidly doesn't re-hit Resend or Redis.
let lastResponseCache: { body: unknown; computedAt: number } | null = null;
const CACHE_TTL_MS = 25_000;

export async function GET() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "RESEND_API_KEY not set" }, { status: 500 });
  }

  if (lastResponseCache && Date.now() - lastResponseCache.computedAt < CACHE_TTL_MS) {
    return NextResponse.json(lastResponseCache.body, {
      headers: { "Cache-Control": "no-store, max-age=0", "X-Cache": "HIT" },
    });
  }

  const recs = recipients as Recipient[];
  const idsToFetch = recs.map((r) => r.resend_id).filter((x): x is string => !!x);

  // Load existing sticky state + fetch latest Resend statuses + load replies — in parallel.
  const [sticky, freshStatuses, replies] = await Promise.all([
    loadSticky(),
    fetchManyResendStatuses(idsToFetch, apiKey),
    listReplies(),
  ]);

  // Merge fresh statuses into sticky. Only entries with higher rank overwrite.
  const updates: Array<{ id: string; entry: StickyEntry }> = [];
  for (const id of idsToFetch) {
    const fresh: ResendEmail | null = freshStatuses[id];
    if (!fresh) continue;
    const prev = sticky[id];
    if (!prev || rank(fresh.last_event) >= rank(prev.last_event)) {
      const entry: StickyEntry = {
        last_event: fresh.last_event,
        created_at: fresh.created_at,
        updated_at: Date.now(),
      };
      sticky[id] = entry;
      updates.push({ id, entry });
    }
  }

  // Persist merged sticky to shared storage (Redis on prod / memory locally).
  await mergeSticky(updates);

  const rows = recs.map((r) => {
    const s = r.resend_id ? sticky[r.resend_id] : null;
    const replyInfo = replies[r.to.toLowerCase()];
    const lastEvent = s?.last_event ?? (r.resend_id ? "unknown" : "quota_failed");
    return {
      i: r.i,
      to: r.to,
      domain: r.to.split("@")[1] ?? "",
      resend_id: r.resend_id,
      status: r.status,
      last_event: lastEvent,
      created_at: s?.created_at ?? null,
      replied: !!replyInfo,
      replied_at: replyInfo?.repliedAt ?? null,
      replied_note: replyInfo?.note ?? null,
    };
  });

  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.last_event] = (acc[r.last_event] ?? 0) + 1;
    return acc;
  }, {});

  const failedThisRound = idsToFetch.filter((id) => !freshStatuses[id]).length;

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

  const body = {
    summary,
    rows,
    fetchedAt: new Date().toISOString(),
    diagnostics: {
      fetched: idsToFetch.length,
      failed_this_round: failedThisRound,
      sticky_cache_size: Object.keys(sticky).length,
      shared_storage: hasRedis() ? "redis" : "memory",
    },
  };

  lastResponseCache = { body, computedAt: Date.now() };

  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store, max-age=0", "X-Cache": "MISS" },
  });
}
