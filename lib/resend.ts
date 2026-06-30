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

export async function fetchResendEmail(id: string, apiKey: string): Promise<ResendEmail | null> {
  try {
    const r = await fetch(`${RESEND_API}/emails/${id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      next: { revalidate: 0 },
      cache: "no-store",
    });
    if (!r.ok) return null;
    const data = await r.json();
    return data as ResendEmail;
  } catch {
    return null;
  }
}

export async function fetchManyResendStatuses(
  ids: string[],
  apiKey: string,
  concurrency = 12,
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
