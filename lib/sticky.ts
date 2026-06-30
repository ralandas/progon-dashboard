import { getRedis } from "./redis";

export type StickyEntry = {
  last_event: string;
  created_at: string | null;
  updated_at: number;
};

const REDIS_KEY = "progon:sticky";

// In-memory fallback when Redis isn't configured (local dev only).
const memoryStore: Record<string, StickyEntry> = {};

export const EVENT_RANK: Record<string, number> = {
  unknown: 0,
  sent: 1,
  delivery_delayed: 2,
  complained: 3,
  bounced: 4,
  delivered: 5,
  opened: 6,
  clicked: 7,
};

export function rank(ev: string): number {
  return EVENT_RANK[ev] ?? 0;
}

export async function loadSticky(): Promise<Record<string, StickyEntry>> {
  const redis = getRedis();
  if (!redis) return { ...memoryStore };
  const map = await redis.hgetall<Record<string, StickyEntry>>(REDIS_KEY);
  return map ?? {};
}

// Bulk merge — only writes entries whose new event has a higher (or equal) rank
// than what's already stored, preserving monotonic progress.
export async function mergeSticky(
  updates: Array<{ id: string; entry: StickyEntry }>,
): Promise<void> {
  if (updates.length === 0) return;

  const redis = getRedis();
  if (!redis) {
    for (const { id, entry } of updates) {
      const prev = memoryStore[id];
      if (!prev || rank(entry.last_event) >= rank(prev.last_event)) {
        memoryStore[id] = entry;
      }
    }
    return;
  }

  const current = await redis.hgetall<Record<string, StickyEntry>>(REDIS_KEY);
  const toWrite: Record<string, StickyEntry> = {};
  for (const { id, entry } of updates) {
    const prev = current?.[id];
    if (!prev || rank(entry.last_event) >= rank(prev.last_event)) {
      toWrite[id] = entry;
    }
  }
  if (Object.keys(toWrite).length > 0) {
    await redis.hset(REDIS_KEY, toWrite);
  }
}
