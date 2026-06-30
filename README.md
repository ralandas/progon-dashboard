# Progon Dashboard

Real-time дашборд для cold-email рассылки Progon.pro. Тянет статусы напрямую из Resend API (no DB), показывает по каждому получателю: доставлено / открыто / кликнуто / bounce / ответил.

![ui](docs/screenshot.png)

---

## Что внутри

- **Next.js 14** (app router, TypeScript, Tailwind)
- **`/api/stats`** — pulls Resend status для каждого `resend_id`, агрегирует summary
- **`/api/replied`** — POST/DELETE для ручной отметки «школа ответила»
- **`middleware.ts`** — Basic Auth для всех роутов
- **`data/recipients.json`** — 200 получателей с их `resend_id` от прогона рассылки 30 июня

---

## Deploy на Vercel (3 минуты)

1. Импортируй репо в Vercel: <https://vercel.com/new>
2. Выбери `ralandas/progon-dashboard`
3. На шаге **Environment Variables** добавь:
   - `RESEND_API_KEY` — ключ из Resend (тот же что в leadfactory)
   - `BASIC_AUTH_USER` — например `progon`
   - `BASIC_AUTH_PASS` — задай любой
4. **Deploy** — через 2 минуты дашборд на `https://progon-dashboard.vercel.app`

---

## Локальный запуск

```bash
git clone https://github.com/ralandas/progon-dashboard
cd progon-dashboard
npm install
cp .env.example .env.local
# заполни RESEND_API_KEY
npm run dev
# http://localhost:3000
```

---

## Структура

```
.
├── app/
│   ├── api/
│   │   ├── stats/route.ts      ← pulls Resend statuses
│   │   └── replied/route.ts    ← mark/unmark replied
│   ├── page.tsx                ← главная — таблица + счётчики
│   ├── layout.tsx
│   └── globals.css
├── lib/
│   ├── resend.ts               ← Resend API client (parallel fetch)
│   └── replies.ts              ← reply marks store (file-backed)
├── data/
│   └── recipients.json         ← 200 получателей с resend_id
├── middleware.ts               ← Basic auth
└── .env.example
```

---

## Как работает tracking

1. **Resend events** (`delivered`, `opened`, `clicked`, `bounced`, `complained`) тянутся каждые 30 сек (настраивается в UI) для всех 200 `resend_id` параллельно.
2. **Replied** не отслеживается Resend (потому что `reply_to` ведёт на внешний `progon.lpr@mail.ru`), поэтому помечается **вручную** кликом по галочке в таблице. Сохраняется в `data/replies.json` локально или в `/tmp/replies.json` на Vercel.
3. **Без БД** — стэйт = `recipients.json` (статичный список) + Resend как источник истины + локальный файл с reply-марками.

---

## Следующая партия рассылки

Когда Кирилл попросит повторить прогон или прогнать новую базу — обновить `data/recipients.json`:

```bash
# В корне leadfactory:
cd ../leadfatory
LIVE=1 node scripts/broadcast-kirill-partnership.js
# Скопировать новый лог:
node -e "const fs=require('fs');const lines=fs.readFileSync('.tmp/kirill-broadcast-log.jsonl','utf8').trim().split('\n').map(JSON.parse);const rows=lines.map((l,i)=>({i:i+1,to:l.to,resend_id:l.status==='sent'?l.resend_id:null,status:l.status}));fs.writeFileSync('../progon-dashboard/data/recipients.json',JSON.stringify(rows,null,2));"

# Commit и пуш — Vercel задеплоит автоматом:
cd ../progon-dashboard
git add data/recipients.json
git commit -m "sync recipients $(date +%Y-%m-%d)"
git push
```

---

## Ограничения / что доделать потом

- **Replies marks ephemeral на Vercel** — `/tmp` сбрасывается на cold start. Если нужна персистентность, добавить Vercel KV: `npm install @vercel/kv`, заменить `lib/replies.ts`.
- **Inbox-парсинг для авто-replied** — сейчас вручную. Можно подключить IMAP к `progon.lpr@mail.ru` и парсить inbox раз в 5 минут.
- **Сегментация по доменам** — если будет несколько кампаний, добавить колонку `campaign` в `recipients.json` и фильтр в UI.

---

## Контекст

Часть проекта **Лид Завод** (`ralandas/leadfactory`). Рассылка прогнана 30 июня 2026 на 200 email-адресов школ недвижимости (Москва, СПб, регионы) с офером партнёрства Progon.pro.

Заказчик: Кирилл (`+79968974380`), ответы летят на `progon.lpr@mail.ru`.
