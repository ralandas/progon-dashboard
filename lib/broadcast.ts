import recipients from "@/data/recipients.json";
import { getRedis } from "./redis";
import { listReplies } from "./replies";
import { loadSticky } from "./sticky";

type Recipient = { i: number; to: string; resend_id: string | null; status: string };

export const PARTNERSHIP_TEXT = `Здравствуйте!

Меня зовут Кирилл, я представляю команду Progon.pro.

Последние несколько недель мы изучали рынок обучения риелторов и посуточной аренды. Ваша школа вошла в число проектов, с которыми, на наш взгляд, может получиться действительно сильное партнерство.

У нас появилась идея, которая может одновременно:

— увеличить ценность вашего обучения;
— дать ученикам современный AI-инструмент для работы с объектами недвижимости;
— создать для школы дополнительный источник дохода без изменения основной программы обучения.

Мы уже подготовили концепцию сотрудничества именно для образовательных проектов в сфере недвижимости. Это не стандартная партнерская программа, а полноценная модель интеграции AI в обучение с финансовой выгодой для школы и ее учеников.

Даже если сейчас партнерства не входят в ваши планы, буду благодарен за короткий ответ это поможет понять, стоит ли продолжать диалог.

Спасибо!

Кирилл (+79968974380) звоните в любое время
Progon.pro`;

export const FROM = "Кирилл (Progon.pro) <kirill@proprogon.ru>";
export const REPLY_TO = "progon.lpr@mail.ru";
export const SUBJECT_RETRY = "Партнерство — короткое напоминание";

type ResendSendResult = { ok: boolean; id?: string; status: number; error?: string };

async function sendOne(to: string, subject: string, apiKey: string): Promise<ResendSendResult> {
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        reply_to: [REPLY_TO],
        subject,
        text: PARTNERSHIP_TEXT,
      }),
    });
    const j = (await r.json()) as { id?: string; statusCode?: number; message?: string };
    if (r.ok && j.id) return { ok: true, id: j.id, status: r.status };
    return { ok: false, status: r.status, error: j.message || JSON.stringify(j) };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

// Decide who gets the retry: everyone except hard-bounced and already-replied.
export async function pickRetryRecipients(): Promise<{
  total: number;
  candidates: string[];
  excluded_bounced: number;
  excluded_replied: number;
  excluded_no_resend_id: number;
}> {
  const [sticky, replies] = await Promise.all([loadSticky(), listReplies()]);
  const recs = recipients as Recipient[];

  const candidates: string[] = [];
  let excludedBounced = 0;
  let excludedReplied = 0;
  let excludedNoId = 0;

  for (const r of recs) {
    if (!r.resend_id) {
      excludedNoId++;
      continue;
    }
    const ev = sticky[r.resend_id]?.last_event;
    if (ev === "bounced") {
      excludedBounced++;
      continue;
    }
    if (replies[r.to.toLowerCase()]) {
      excludedReplied++;
      continue;
    }
    candidates.push(r.to);
  }

  return {
    total: recs.length,
    candidates,
    excluded_bounced: excludedBounced,
    excluded_replied: excludedReplied,
    excluded_no_resend_id: excludedNoId,
  };
}

export type RetryResult = {
  ok: boolean;
  error?: string;
  attempted: number;
  sent: number;
  failed: number;
  dry_run: boolean;
  per_recipient: Array<{ to: string; ok: boolean; resend_id?: string; error?: string }>;
  excluded_bounced: number;
  excluded_replied: number;
};

const RETRY_LOG_KEY = "progon:retry-broadcasts";

export async function runRetryBroadcast(opts: {
  dryRun?: boolean;
  delayMs?: number;
  subject?: string;
}): Promise<RetryResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error: "RESEND_API_KEY not set",
      attempted: 0,
      sent: 0,
      failed: 0,
      dry_run: !!opts.dryRun,
      per_recipient: [],
      excluded_bounced: 0,
      excluded_replied: 0,
    };
  }

  const subject = opts.subject || SUBJECT_RETRY;
  const delayMs = opts.delayMs ?? 500;
  const dryRun = !!opts.dryRun;

  const pick = await pickRetryRecipients();
  const perRecipient: RetryResult["per_recipient"] = [];
  let sent = 0;
  let failed = 0;

  for (const to of pick.candidates) {
    if (dryRun) {
      perRecipient.push({ to, ok: true });
      sent++;
      continue;
    }
    const r = await sendOne(to, subject, apiKey);
    if (r.ok) {
      perRecipient.push({ to, ok: true, resend_id: r.id });
      sent++;
    } else {
      perRecipient.push({ to, ok: false, error: `status=${r.status} ${r.error || ""}` });
      failed++;
    }
    if (delayMs > 0) await new Promise((res) => setTimeout(res, delayMs));
  }

  // Persist a short summary of this run to Redis for audit (rolling list, capped).
  const redis = getRedis();
  if (redis) {
    const summary = {
      ts: new Date().toISOString(),
      subject,
      dry_run: dryRun,
      attempted: pick.candidates.length,
      sent,
      failed,
      excluded_bounced: pick.excluded_bounced,
      excluded_replied: pick.excluded_replied,
    };
    await redis.lpush(RETRY_LOG_KEY, summary);
    await redis.ltrim(RETRY_LOG_KEY, 0, 49); // keep last 50 runs
  }

  return {
    ok: true,
    attempted: pick.candidates.length,
    sent,
    failed,
    dry_run: dryRun,
    per_recipient: perRecipient,
    excluded_bounced: pick.excluded_bounced,
    excluded_replied: pick.excluded_replied,
  };
}

export async function listRetryHistory(): Promise<unknown[]> {
  const redis = getRedis();
  if (!redis) return [];
  const items = await redis.lrange(RETRY_LOG_KEY, 0, 49);
  return items as unknown[];
}
