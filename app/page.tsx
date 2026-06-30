"use client";

import { useEffect, useMemo, useState } from "react";

type Row = {
  i: number;
  to: string;
  domain: string;
  resend_id: string | null;
  status: string;
  last_event: string;
  created_at: string | null;
  replied: boolean;
  replied_at: string | null;
  replied_note: string | null;
};

type Summary = {
  total: number;
  sent: number;
  delivered: number;
  bounced: number;
  opened: number;
  clicked: number;
  complained: number;
  delayed: number;
  sent_only: number;
  quota_failed: number;
  unknown: number;
  replied: number;
};

type Diagnostics = {
  fetched: number;
  failed_this_round: number;
  sticky_cache_size: number;
  shared_storage?: "redis" | "memory";
};

type StatsResp = { summary: Summary; rows: Row[]; fetchedAt: string; diagnostics?: Diagnostics };

const EVENT_COLORS: Record<string, string> = {
  delivered: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  opened: "bg-sky-500/20 text-sky-300 border-sky-500/40",
  clicked: "bg-indigo-500/20 text-indigo-300 border-indigo-500/40",
  bounced: "bg-rose-500/20 text-rose-300 border-rose-500/40",
  complained: "bg-orange-500/20 text-orange-300 border-orange-500/40",
  delivery_delayed: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  sent: "bg-zinc-500/20 text-zinc-300 border-zinc-500/40",
  unknown: "bg-zinc-700/30 text-zinc-400 border-zinc-700/50",
  quota_failed: "bg-rose-900/30 text-rose-400 border-rose-900/50",
};

const REFRESH_OPTIONS = [
  { label: "30 сек", value: 30 },
  { label: "1 мин", value: 60 },
  { label: "5 мин", value: 300 },
  { label: "Off", value: 0 },
];

export default function Dashboard() {
  const [data, setData] = useState<StatsResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshSec, setRefreshSec] = useState<number>(30);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [query, setQuery] = useState<string>("");
  const [tick, setTick] = useState(0);
  const [imapStatus, setImapStatus] = useState<string | null>(null);
  const [imapLoading, setImapLoading] = useState(false);
  const [retryModalOpen, setRetryModalOpen] = useState(false);

  const fetchStats = async () => {
    try {
      setLoading(true);
      setError(null);
      const r = await fetch("/api/stats", { cache: "no-store" });
      if (!r.ok) throw new Error(`Status ${r.status}`);
      const json = (await r.json()) as StatsResp;
      setData(json);
      setLastFetch(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  useEffect(() => {
    if (refreshSec <= 0) return;
    const id = setInterval(fetchStats, refreshSec * 1000);
    return () => clearInterval(id);
  }, [refreshSec]);

  useEffect(() => {
    const id = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [] as Row[];
    return data.rows.filter((r) => {
      if (filter === "replied" && !r.replied) return false;
      if (filter === "delivered" && r.last_event !== "delivered") return false;
      if (filter === "bounced" && r.last_event !== "bounced") return false;
      if (filter === "opened" && r.last_event !== "opened") return false;
      if (filter === "no_event" && (r.last_event === "delivered" || r.last_event === "opened" || r.last_event === "clicked" || r.last_event === "bounced")) return false;
      if (query) {
        const q = query.toLowerCase();
        if (!r.to.toLowerCase().includes(q) && !r.domain.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [data, filter, query]);

  const secondsSince = lastFetch ? Math.floor((Date.now() - lastFetch.getTime()) / 1000) : null;

  const toggleReplied = async (row: Row) => {
    const method = row.replied ? "DELETE" : "POST";
    await fetch("/api/replied", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: row.to }),
    });
    fetchStats();
  };

  const runImapSync = async () => {
    try {
      setImapLoading(true);
      setImapStatus("Сканирую inbox progon.lpr@mail.ru…");
      const r = await fetch("/api/imap-sync?sinceDays=14", { method: "POST" });
      const j = await r.json();
      if (!j.ok) {
        setImapStatus(`Ошибка: ${j.error}`);
      } else {
        const parts = [
          `Просмотрено ${j.scanned} писем`,
          `новых ответов: ${j.marked_new}`,
          `уже отмеченных: ${j.already_marked}`,
          `не в нашем списке: ${j.ignored_not_in_list}`,
        ];
        setImapStatus(parts.join(" · "));
      }
      fetchStats();
    } catch (e) {
      setImapStatus(`Ошибка: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setImapLoading(false);
    }
  };

  return (
    <div className="px-4 sm:px-8 py-6 max-w-[1400px] mx-auto">
      <header className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Progon.pro — рассылка партнёрства</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Школы недвижимости (Москва+СПб), офер «Партнерство». Источник статусов: Resend API.
            {secondsSince !== null && (
              <span className="ml-2">
                Обновлено {secondsSince === 0 ? "только что" : `${secondsSince} сек назад`}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-zinc-400">Авто-рефреш:</label>
          <select
            value={refreshSec}
            onChange={(e) => setRefreshSec(Number(e.target.value))}
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm"
          >
            {REFRESH_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            onClick={fetchStats}
            disabled={loading}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white px-3 py-1 rounded text-sm"
          >
            {loading ? "..." : "Обновить"}
          </button>
          <button
            onClick={runImapSync}
            disabled={imapLoading}
            title="Прочитать inbox progon.lpr@mail.ru и отметить школы, которые ответили"
            className="bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white px-3 py-1 rounded text-sm"
          >
            {imapLoading ? "Сканирую..." : "Проверить ответы"}
          </button>
          <button
            onClick={() => setRetryModalOpen(true)}
            title="Прогнать повторное письмо по тем кто не bounce и не ответил"
            className="bg-amber-600 hover:bg-amber-500 text-white px-3 py-1 rounded text-sm"
          >
            Прогнать повтор
          </button>
        </div>
      </header>

      {retryModalOpen && (
        <RetryModal
          onClose={() => setRetryModalOpen(false)}
          onAfter={() => fetchStats()}
        />
      )}

      {imapStatus && (
        <div className="bg-purple-900/20 border border-purple-700/40 text-purple-200 rounded p-2 mb-4 text-xs">
          IMAP: {imapStatus}
        </div>
      )}

      {error && (
        <div className="bg-rose-900/30 border border-rose-700 text-rose-200 rounded p-3 mb-4 text-sm">
          Ошибка загрузки: {error}
        </div>
      )}

      {data && (
        <>
          <section className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
            <StatCard
              label="Всего"
              value={data.summary.total}
              sub={`${data.summary.sent} принято Resend`}
              tooltip="Сколько всего email-адресов в базе рассылки. Из них N принято Resend (наш email-провайдер) на отправку. Остальные 3 не ушли — упёрлись в дневной лимит, догоним завтра."
            />
            <StatCard
              label="Доставлено"
              value={data.summary.delivered}
              accent="emerald"
              tooltip="Письмо физически легло в Inbox получателя. Mail-сервер школы подтвердил приём. Это база для отслеживания дальнейших действий — открытий, кликов, ответов."
            />
            <StatCard
              label="Открыто"
              value={data.summary.opened}
              accent="sky"
              tooltip="Получатель открыл письмо в почтовом клиенте. Трекается через скрытый пиксель Resend. Внимание: корп-серверы (mail.ru/yandex/exchange) часто режут пиксели — реальная открываемость может быть выше."
            />
            <StatCard
              label="Кликнуто"
              value={data.summary.clicked}
              accent="indigo"
              tooltip="Получатель кликнул по ссылке в письме. В нашей рассылке ссылок нет (только телефон Кирилла) — поэтому здесь всегда 0."
            />
            <StatCard
              label="Bounce"
              value={data.summary.bounced}
              accent="rose"
              sub="мёртвые ящики"
              tooltip="Адреса не существуют. Mail-сервер ответил «нет такого ящика». Бренды (Cian, Domclick, Etagi, PIK) не держат шаблонных academy@/school@/edu@. Повторно слать бесполезно — НЕ включаем в следующий прогон."
            />
            <StatCard
              label="В пути"
              value={data.summary.sent_only + data.summary.delayed + data.summary.unknown}
              accent="amber"
              sub="нет события"
              tooltip="Resend письмо отправил, но получающий сервер пока не подтвердил доставку. Либо greylist-задержка (mail.ru тормозит на холодных отправителях), либо письмо приняли но без сигнала Resend-у. Часть в итоге станет delivered, часть — bounce."
            />
            <StatCard
              label="Ответили"
              value={data.summary.replied}
              accent="purple"
              sub="отмечено вручную"
              tooltip="Школа ответила на письмо. Считается вручную: Кирилл кликает галочку в таблице когда видит ответ в progon.lpr@mail.ru. В будущем можно автоматизировать через IMAP — будет автоматически отмечать."
            />
          </section>

          <section className="flex items-center gap-2 mb-3 flex-wrap">
            <input
              type="text"
              placeholder="Поиск по email / домену"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm w-64"
            />
            {[
              { v: "all", l: "Все" },
              { v: "delivered", l: "Доставлено" },
              { v: "opened", l: "Открыто" },
              { v: "bounced", l: "Bounce" },
              { v: "no_event", l: "В пути" },
              { v: "replied", l: "Ответили" },
            ].map((b) => (
              <button
                key={b.v}
                onClick={() => setFilter(b.v)}
                className={`px-3 py-1.5 rounded text-xs border ${
                  filter === b.v
                    ? "bg-zinc-700 border-zinc-500 text-white"
                    : "bg-zinc-900 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                }`}
              >
                {b.l}
              </button>
            ))}
            <span className="text-xs text-zinc-500 ml-2">
              показано {filtered.length} из {data.rows.length}
            </span>
          </section>

          <section className="border border-zinc-800 rounded overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-zinc-900/80 sticky top-0">
                  <tr className="text-left text-zinc-400">
                    <th className="px-3 py-2 w-10">#</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Домен</th>
                    <th className="px-3 py-2">Статус</th>
                    <th className="px-3 py-2">Время</th>
                    <th className="px-3 py-2 text-center w-24">Ответил</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const ev = r.last_event;
                    const color = EVENT_COLORS[ev] ?? EVENT_COLORS.unknown;
                    return (
                      <tr key={r.i} className="border-t border-zinc-800 hover:bg-zinc-900/40">
                        <td className="px-3 py-2 text-zinc-500">{r.i}</td>
                        <td className="px-3 py-2 font-mono text-xs">{r.to}</td>
                        <td className="px-3 py-2 text-zinc-400 text-xs">{r.domain}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-block px-2 py-0.5 rounded text-xs border ${color}`}>
                            {ev}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-zinc-500 text-xs">
                          {r.created_at ? new Date(r.created_at).toLocaleString("ru-RU") : "—"}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button
                            onClick={() => toggleReplied(r)}
                            className={`px-2 py-0.5 rounded text-xs border ${
                              r.replied
                                ? "bg-purple-500/20 text-purple-300 border-purple-500/40"
                                : "bg-zinc-900 text-zinc-500 border-zinc-700 hover:text-zinc-300"
                            }`}
                          >
                            {r.replied ? "✓" : "—"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <footer className="text-xs text-zinc-500 mt-6">
            Tick: {tick} · Fetched: {new Date(data.fetchedAt).toLocaleTimeString("ru-RU")}
            {data.diagnostics && (
              <span className="ml-3">
                · API: {data.diagnostics.fetched - data.diagnostics.failed_this_round}/{data.diagnostics.fetched} ответили
                {data.diagnostics.failed_this_round > 0 && (
                  <span className="text-amber-400 ml-1">
                    (sticky cache использован для {data.diagnostics.failed_this_round})
                  </span>
                )}
                {data.diagnostics.shared_storage && (
                  <span
                    className={`ml-3 ${
                      data.diagnostics.shared_storage === "redis"
                        ? "text-emerald-400"
                        : "text-amber-400"
                    }`}
                  >
                    · storage: {data.diagnostics.shared_storage}
                    {data.diagnostics.shared_storage === "memory" && (
                      <span className="text-zinc-500"> (общий стейт между users не работает)</span>
                    )}
                  </span>
                )}
              </span>
            )}
          </footer>
        </>
      )}

      {!data && !error && (
        <div className="text-zinc-400 text-sm">Загружаю статусы из Resend…</div>
      )}
    </div>
  );
}

function RetryModal({ onClose, onAfter }: { onClose: () => void; onAfter: () => void }) {
  type Preview = {
    total: number;
    candidates: string[];
    excluded_bounced: number;
    excluded_replied: number;
    excluded_no_resend_id: number;
  };
  type HistoryItem = {
    ts: string;
    subject: string;
    dry_run: boolean;
    attempted: number;
    sent: number;
    failed: number;
  };
  const [preview, setPreview] = useState<Preview | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [subject, setSubject] = useState("Партнерство — короткое напоминание");
  const [dryRun, setDryRun] = useState(true);
  const [confirmText, setConfirmText] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/broadcast-retry", { cache: "no-store" });
      const j = (await r.json()) as { preview: Preview; history: HistoryItem[] };
      setPreview(j.preview);
      setHistory(j.history);
    })();
  }, []);

  const expectedConfirm = "ПРОГНАТЬ";
  const canRun = confirmText === expectedConfirm && !!preview && preview.candidates.length > 0;

  const execute = async () => {
    if (!canRun) return;
    setRunning(true);
    setResult(null);
    try {
      const r = await fetch("/api/broadcast-retry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dryRun,
          subject,
          delayMs: 500,
          confirm: "RETRY-BROADCAST",
        }),
      });
      const j = (await r.json()) as {
        ok: boolean;
        attempted: number;
        sent: number;
        failed: number;
        dry_run: boolean;
        error?: string;
      };
      if (!j.ok) {
        setResult(`Ошибка: ${j.error}`);
      } else {
        setResult(
          `${j.dry_run ? "DRY-RUN" : "LIVE"}: попытка ${j.attempted}, успех ${j.sent}, ошибок ${j.failed}`,
        );
      }
      onAfter();
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-zinc-900 border border-zinc-700 rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
      >
        <div className="flex justify-between items-start mb-4">
          <h2 className="text-xl font-semibold">Повторная рассылка</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-xl">✕</button>
        </div>

        {!preview ? (
          <div className="text-zinc-400 text-sm">Загружаю превью…</div>
        ) : (
          <>
            <div className="bg-zinc-800/50 rounded p-4 mb-4">
              <div className="text-sm text-zinc-300 mb-2">Кому уйдёт:</div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <div className="text-3xl font-bold text-amber-400">{preview.candidates.length}</div>
                  <div className="text-xs text-zinc-500">кандидатов</div>
                </div>
                <div>
                  <div className="text-3xl font-bold text-rose-400">{preview.excluded_bounced}</div>
                  <div className="text-xs text-zinc-500">bounce исключены</div>
                </div>
                <div>
                  <div className="text-3xl font-bold text-purple-400">{preview.excluded_replied}</div>
                  <div className="text-xs text-zinc-500">ответили (не шлём)</div>
                </div>
              </div>
            </div>

            <div className="mb-4">
              <label className="text-xs text-zinc-400 block mb-1">Тема повтора</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm w-full"
              />
            </div>

            <div className="mb-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} />
                <span>Dry-run (не отправлять, только посчитать)</span>
              </label>
            </div>

            <div className="mb-4">
              <label className="text-xs text-zinc-400 block mb-1">
                Введите <code className="bg-zinc-800 px-1 rounded">{expectedConfirm}</code> для подтверждения:
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm w-full font-mono"
              />
            </div>

            <button
              onClick={execute}
              disabled={!canRun || running}
              className="bg-amber-600 hover:bg-amber-500 disabled:opacity-30 disabled:cursor-not-allowed text-white px-4 py-2 rounded w-full"
            >
              {running ? "Шлю..." : dryRun ? "Запустить DRY-RUN" : `LIVE: отправить ${preview.candidates.length} писем`}
            </button>

            {result && (
              <div className="mt-4 p-3 bg-zinc-800 rounded text-sm">{result}</div>
            )}

            {history.length > 0 && (
              <div className="mt-6">
                <div className="text-sm text-zinc-400 mb-2">История повторов</div>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {history.map((h, i) => (
                    <div key={i} className="text-xs bg-zinc-800/50 rounded p-2 flex justify-between">
                      <span className="text-zinc-400">{new Date(h.ts).toLocaleString("ru-RU")}</span>
                      <span>
                        {h.dry_run ? "DRY" : "LIVE"}: попытка {h.attempted}, успех {h.sent}, ошибок {h.failed}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  accent,
  tooltip,
}: {
  label: string;
  value: number;
  sub?: string;
  accent?: "emerald" | "sky" | "indigo" | "rose" | "amber" | "purple";
  tooltip?: string;
}) {
  const accentClass: Record<string, string> = {
    emerald: "text-emerald-400",
    sky: "text-sky-400",
    indigo: "text-indigo-400",
    rose: "text-rose-400",
    amber: "text-amber-400",
    purple: "text-purple-400",
  };
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded p-3 relative group">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 flex items-center gap-1">
        {label}
        {tooltip && (
          <span
            title={tooltip}
            className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-zinc-700 text-zinc-300 text-[9px] cursor-help"
          >
            ?
          </span>
        )}
      </div>
      <div className={`text-2xl font-bold mt-1 ${accent ? accentClass[accent] : "text-zinc-100"}`}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-zinc-500 mt-0.5">{sub}</div>}
      {tooltip && (
        <div className="hidden group-hover:block absolute top-full left-0 right-0 mt-1 z-10 bg-zinc-900 border border-zinc-700 rounded p-2 text-xs text-zinc-300 shadow-lg leading-relaxed">
          {tooltip}
        </div>
      )}
    </div>
  );
}
