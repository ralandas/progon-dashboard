import fs from "node:fs/promises";
import path from "node:path";
import { getRedis } from "./redis";

const REDIS_KEY = "progon:replies";

const FILE_PATH =
  process.env.REPLIES_FILE ||
  (process.env.VERCEL ? "/tmp/replies.json" : path.join(process.cwd(), "data", "replies.json"));

export type ReplyInfo = { repliedAt: string; note?: string };
export type RepliesMap = Record<string, ReplyInfo>;

async function readFromFile(): Promise<RepliesMap> {
  try {
    const raw = await fs.readFile(FILE_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && "byEmail" in parsed) {
      const byEmail = (parsed as { byEmail?: RepliesMap }).byEmail;
      if (byEmail) return byEmail;
    }
    return (parsed as RepliesMap) ?? {};
  } catch {
    return {};
  }
}

async function writeToFile(map: RepliesMap): Promise<void> {
  await fs.mkdir(path.dirname(FILE_PATH), { recursive: true });
  await fs.writeFile(FILE_PATH, JSON.stringify({ byEmail: map }, null, 2), "utf8");
}

export async function listReplies(): Promise<RepliesMap> {
  const redis = getRedis();
  if (redis) {
    const stored = await redis.hgetall<Record<string, ReplyInfo>>(REDIS_KEY);
    return stored ?? {};
  }
  return readFromFile();
}

export async function markReplied(email: string, note?: string): Promise<void> {
  const key = email.toLowerCase();
  const info: ReplyInfo = { repliedAt: new Date().toISOString(), ...(note ? { note } : {}) };

  const redis = getRedis();
  if (redis) {
    await redis.hset(REDIS_KEY, { [key]: info });
    return;
  }
  const map = await readFromFile();
  map[key] = info;
  await writeToFile(map);
}

export async function unmarkReplied(email: string): Promise<void> {
  const key = email.toLowerCase();

  const redis = getRedis();
  if (redis) {
    await redis.hdel(REDIS_KEY, key);
    return;
  }
  const map = await readFromFile();
  delete map[key];
  await writeToFile(map);
}
