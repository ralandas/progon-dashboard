import { Redis } from "@upstash/redis";

let _redis: Redis | null = null;
let _checked = false;

// Single shared Redis client. Lazily initialized so build-time prerendering
// doesn't crash when env-vars aren't present.
//
// We accept two env var name styles:
// - Vercel's KV preset (KV_REST_API_URL / KV_REST_API_TOKEN) — what Vercel auto-injects
//   when you connect an Upstash Redis store via the Vercel Storage tab.
// - Upstash's own style (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN).
//
// First match wins.
export function getRedis(): Redis | null {
  if (_checked) return _redis;
  _checked = true;

  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) return null;

  _redis = new Redis({ url, token });
  return _redis;
}

export function hasRedis(): boolean {
  return getRedis() !== null;
}
