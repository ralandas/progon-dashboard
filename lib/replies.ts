import fs from "node:fs/promises";
import path from "node:path";

// Where we store the manually-marked replies.
// On Vercel runtime FS is read-only for everything except /tmp — so we use /tmp,
// understanding that it's ephemeral per container (resets on cold start).
// For a real persistence layer, swap to Vercel KV / Edge Config later.
const REPLIES_FILE = process.env.REPLIES_FILE || (process.env.VERCEL ? "/tmp/replies.json" : path.join(process.cwd(), "data", "replies.json"));

type RepliesStore = {
  byEmail: Record<string, { repliedAt: string; note?: string }>;
};

async function readStore(): Promise<RepliesStore> {
  try {
    const raw = await fs.readFile(REPLIES_FILE, "utf8");
    return JSON.parse(raw) as RepliesStore;
  } catch {
    return { byEmail: {} };
  }
}

async function writeStore(store: RepliesStore): Promise<void> {
  await fs.mkdir(path.dirname(REPLIES_FILE), { recursive: true });
  await fs.writeFile(REPLIES_FILE, JSON.stringify(store, null, 2), "utf8");
}

export async function listReplies(): Promise<RepliesStore["byEmail"]> {
  const store = await readStore();
  return store.byEmail;
}

export async function markReplied(email: string, note?: string): Promise<void> {
  const store = await readStore();
  store.byEmail[email.toLowerCase()] = {
    repliedAt: new Date().toISOString(),
    ...(note ? { note } : {}),
  };
  await writeStore(store);
}

export async function unmarkReplied(email: string): Promise<void> {
  const store = await readStore();
  delete store.byEmail[email.toLowerCase()];
  await writeStore(store);
}
