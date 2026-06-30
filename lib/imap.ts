import { ImapFlow } from "imapflow";
import recipients from "@/data/recipients.json";
import { markReplied, listReplies } from "./replies";

type Recipient = { i: number; to: string; resend_id: string | null; status: string };

// Address patterns we ignore — these are NOT replies from real schools.
const BOUNCE_SENDERS = [
  "mailer-daemon",
  "postmaster",
  "bounce",
  "noreply",
  "no-reply",
  "do-not-reply",
];

// Mail-Daemon-style addresses (mailer-daemon@*, etc) — case-insensitive substring.
function isBounceOrSystem(from: string): boolean {
  const lower = from.toLowerCase();
  return BOUNCE_SENDERS.some((p) => lower.includes(p));
}

// Extract bare email from an IMAP address header value like:
//   "Имя <foo@bar.ru>" -> "foo@bar.ru"
//   "<foo@bar.ru>" -> "foo@bar.ru"
//   "foo@bar.ru" -> "foo@bar.ru"
function extractEmail(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const m = raw.match(/<([^>]+)>/);
  const candidate = (m ? m[1] : raw).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(candidate)) return null;
  return candidate;
}

export type ImapSyncResult = {
  ok: boolean;
  error?: string;
  scanned: number;
  marked_new: number;
  already_marked: number;
  ignored_bounce: number;
  ignored_not_in_list: number;
  newly_marked_emails: string[];
};

export async function syncReplies(opts?: { sinceDays?: number }): Promise<ImapSyncResult> {
  const host = process.env.IMAP_HOST || "imap.mail.ru";
  const port = Number(process.env.IMAP_PORT || "993");
  const user = process.env.IMAP_USER;
  const password = process.env.IMAP_PASSWORD;

  if (!user || !password) {
    return {
      ok: false,
      error: "IMAP_USER / IMAP_PASSWORD env vars are not configured",
      scanned: 0,
      marked_new: 0,
      already_marked: 0,
      ignored_bounce: 0,
      ignored_not_in_list: 0,
      newly_marked_emails: [],
    };
  }

  // Build a set of recipient emails for O(1) lookup.
  const recipientSet = new Set(
    (recipients as Recipient[]).map((r) => r.to.toLowerCase()),
  );
  const already = await listReplies();

  let scanned = 0;
  let markedNew = 0;
  let ignoredBounce = 0;
  let ignoredNotInList = 0;
  let alreadyMarked = 0;
  const newlyMarkedEmails: string[] = [];

  const client = new ImapFlow({
    host,
    port,
    secure: true,
    auth: { user, pass: password },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      const sinceDays = opts?.sinceDays ?? 14;
      const since = new Date(Date.now() - sinceDays * 24 * 3600 * 1000);

      // SEARCH for messages since N days ago.
      const search = await client.search({ since });
      const uids = Array.isArray(search) ? search : [];

      for (const uid of uids) {
        scanned++;
        const msg = await client.fetchOne(uid, { envelope: true }, { uid: true });
        if (!msg || !msg.envelope) continue;

        const fromAddr = msg.envelope.from?.[0];
        const fromEmail = extractEmail(
          fromAddr
            ? `${fromAddr.name || ""} <${fromAddr.address || ""}>`.trim()
            : null,
        );

        if (!fromEmail) continue;

        if (isBounceOrSystem(fromEmail)) {
          ignoredBounce++;
          continue;
        }

        if (!recipientSet.has(fromEmail)) {
          ignoredNotInList++;
          continue;
        }

        if (already[fromEmail]) {
          alreadyMarked++;
          continue;
        }

        const subject = msg.envelope.subject || "";
        await markReplied(fromEmail, subject);
        markedNew++;
        newlyMarkedEmails.push(fromEmail);
        // Update local cache so we don't double-count if the same email replied twice.
        already[fromEmail] = { repliedAt: new Date().toISOString(), note: subject };
      }
    } finally {
      lock.release();
    }
    await client.logout();

    return {
      ok: true,
      scanned,
      marked_new: markedNew,
      already_marked: alreadyMarked,
      ignored_bounce: ignoredBounce,
      ignored_not_in_list: ignoredNotInList,
      newly_marked_emails: newlyMarkedEmails,
    };
  } catch (err) {
    try {
      await client.logout();
    } catch {}
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      scanned,
      marked_new: markedNew,
      already_marked: alreadyMarked,
      ignored_bounce: ignoredBounce,
      ignored_not_in_list: ignoredNotInList,
      newly_marked_emails: newlyMarkedEmails,
    };
  }
}
