export type ResendEvent =
  | "sent"
  | "delivered"
  | "delivery_delayed"
  | "bounced"
  | "complained"
  | "opened"
  | "clicked"
  | "unknown";

export type ResendEmail = {
  id: string;
  to: string[];
  subject: string;
  last_event: ResendEvent;
  created_at: string;
};

const RESEND_API = "https://api.resend.com";

async function fetchOnce(id: string, apiKey: string): Promise<ResendEmail | null> {
  try {
    const r = await fetch(`${RESEND_API}/emails/${id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
    if (r.status === 429) return null; // rate-limited, signal caller to retry
    if (!r.ok) return null;
    const data = await r.json();
    return data as ResendEmail;
  } catch {
    return null;
  }
}

export async function fetchResendEmail(
  id: string,
  apiKey: string,
  retries = 4,
): Promise<ResendEmail | null> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const r = await fetchOnce(id, apiKey);
    if (r) return r;
    // Exponential backoff: 500ms, 1500ms, 4500ms, 13.5s
    if (attempt < retries - 1) {
      await new Promise((res) => setTimeout(res, 500 * Math.pow(3, attempt)));
    }
  }
  return null;
}

export async function fetchManyResendStatuses(
  ids: string[],
  apiKey: string,
  concurrency = 6,
): Promise<Record<string, ResendEmail | null>> {
  const results: Record<string, ResendEmail | null> = {};
  let cursor = 0;
  const workers: Promise<void>[] = [];
  const next = async () => {
    while (true) {
      const i = cursor++;
      if (i >= ids.length) return;
      const id = ids[i];
      results[id] = await fetchResendEmail(id, apiKey);
    }
  };
  for (let i = 0; i < Math.min(concurrency, ids.length); i++) workers.push(next());
  await Promise.all(workers);
  return results;
}
