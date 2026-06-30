import { NextResponse } from "next/server";
import recipients from "@/data/recipients.json";
import { fetchManyResendStatuses, type ResendEmail } from "@/lib/resend";
import { listReplies } from "@/lib/replies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Recipient = { i: number; to: string; resend_id: string | null; status: string };

// Persistent cache of "best known" event per resend_id across requests.
// Keeps progress monotonic — if Resend says "delivered" once, we never go back to "sent" or "unknown"
// just because a later API call timed out.
type StickyEntry = { last_event: string; created_at: string | null; updated_at: number };
const stickyStatus: Record<string, StickyEntry> = {};

// Rank events by progress — a higher rank can overwrite a lower rank, but never the other way.
const EVENT_RANK: Record<string, number> = {
  unknown: 0,
  sent: 1,
  delivery_delayed: 2,
  complained: 3,
  bounced: 4,
  delivered: 5,
  opened: 6,
  clicked: 7,
};
function rank(ev: string): number {
  return EVENT_RANK[ev] ?? 0;
}

// In-memory cache of the latest computed response. Prevents flicker when "Refresh" is clicked
// twice within a short window and the second call returns fewer results due to transient failures.
let lastResponseCache: { body: unknown; computedAt: number } | null = null;
const CACHE_TTL_MS = 25_000;

export async function GET() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "RESEND_API_KEY not set" }, { status: 500 });
  }

  // Serve cache if fresh
  if (lastResponseCache && Date.now() - lastResponseCache.computedAt < CACHE_TTL_MS) {
    return NextResponse.json(lastResponseCache.body, {
      headers: { "Cache-Control": "no-store, max-age=0", "X-Cache": "HIT" },
    });
  }

  const recs = recipients as Recipient[];
  const idsToFetch = recs.map((r) => r.resend_id).filter((x): x is string => !!x);

  const [statuses, replies] = await Promise.all([
    fetchManyResendStatuses(idsToFetch, apiKey),
    listReplies(),
  ]);

  // Merge fresh statuses into sticky cache, preserving the best-known event per id.
  for (const id of idsToFetch) {
    const fresh: ResendEmail | null = statuses[id];
    if (!fresh) continue; // network/rate-limit failure → keep previous sticky
    const prev = stickyStatus[id];
    if (!prev || rank(fresh.last_event) >= rank(prev.last_event)) {
      stickyStatus[id] = {
        last_event: fresh.last_event,
        created_at: fresh.created_at,
        updated_at: Date.now(),
      };
    }
  }

  const rows = recs.map((r) => {
    const sticky = r.resend_id ? stickyStatus[r.resend_id] : null;
    const replyInfo = replies[r.to.toLowerCase()];
    const lastEvent = sticky?.last_event ?? (r.resend_id ? "unknown" : "quota_failed");
    return {
      i: r.i,
      to: r.to,
      domain: r.to.split("@")[1] ?? "",
      resend_id: r.resend_id,
      status: r.status,
      last_event: lastEvent,
      created_at: sticky?.created_at ?? null,
      replied: !!replyInfo,
      replied_at: replyInfo?.repliedAt ?? null,
      replied_note: replyInfo?.note ?? null,
    };
  });

  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.last_event] = (acc[r.last_event] ?? 0) + 1;
    return acc;
  }, {});

  const failedThisRound = idsToFetch.filter((id) => !statuses[id]).length;

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
      sticky_cache_size: Object.keys(stickyStatus).length,
    },
  };

  lastResponseCache = { body, computedAt: Date.now() };

  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store, max-age=0", "X-Cache": "MISS" },
  });
}
