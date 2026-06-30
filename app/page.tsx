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

type StatsResp = { summary: Summary; rows: Row[]; fetchedAt: string };

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
        </div>
      </header>

      {error && (
        <div className="bg-rose-900/30 border border-rose-700 text-rose-200 rounded p-3 mb-4 text-sm">
          Ошибка загрузки: {error}
        </div>
      )}

      {data && (
        <>
          <section className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
            <StatCard label="Всего" value={data.summary.total} sub={`${data.summary.sent} принято Resend`} />
            <StatCard label="Доставлено" value={data.summary.delivered} accent="emerald" />
            <StatCard label="Открыто" value={data.summary.opened} accent="sky" />
            <StatCard label="Кликнуто" value={data.summary.clicked} accent="indigo" />
            <StatCard label="Bounce" value={data.summary.bounced} accent="rose" sub="мёртвые ящики" />
            <StatCard label="В пути" value={data.summary.sent_only + data.summary.delayed + data.summary.unknown} accent="amber" sub="нет события" />
            <StatCard label="Ответили" value={data.summary.replied} accent="purple" sub="отмечено вручную" />
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
            Tick: {tick} · Fetched at: {data.fetchedAt}
          </footer>
        </>
      )}

      {!data && !error && (
        <div className="text-zinc-400 text-sm">Загружаю статусы из Resend…</div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: number;
  sub?: string;
  accent?: "emerald" | "sky" | "indigo" | "rose" | "amber" | "purple";
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
    <div className="bg-zinc-900/70 border border-zinc-800 rounded p-3">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${accent ? accentClass[accent] : "text-zinc-100"}`}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-zinc-500 mt-0.5">{sub}</div>}
    </div>
  );
}
