# Lead FMS

A standalone website that replaces the Google-Sheet lead tracker: one intake sheet, Lead Qualification with
Follow-Up 1 / 2 / 3, and the Day 1 / Day 2 attendee sheets — with a proper login for every caller.
It is built the same way as (and looks like) the **Reminder List** app: same sidebar, login, light/dark theme,
tables, cards, loaders and offline screen.

```
lead-fms/
  backend/    Express + MongoDB (Mongoose) API
  frontend/   React (Vite) UI
```

## Run it locally

Needs Node 18+ and MongoDB.

```bash
# 1. backend
cd backend
npm install
cp .env.example .env          # set JWT_SECRET (and MONGO_URI if Mongo isn't local)
npm run seed                  # loads the team logins + all leads + call history (see below)
npm run dev                   # API on http://localhost:5000

# 2. frontend (new terminal)
cd frontend
npm install
npm run dev                   # http://localhost:5173  (proxies /api to the backend)
```

No data to import? Create the first admin instead and add everyone from the **Team** page:

```bash
ADMIN_NAME="Nitin" ADMIN_EMAIL="nitin@mysoulschool.in" ADMIN_PASSWORD="a-strong-password" npm run seed:admin
```

## Who sees what

| Role | Sees |
|---|---|
| **Caller** | only leads whose *Assigned To* matches their **caller name** (Lead Qualification, Day 1 or Day 2): My Tasks, Dashboard, Leads, Attendance, Activity, My Reports |
| **Admin** | everything for all callers, plus Daily Board, Reports, Team, Settings, sheet import, bulk assign, mark attendance |

This is enforced by the server on every request, not only hidden in the menu. Login = the person's email.
There is no public sign-up — admins create accounts on **Team** (and can reset passwords, deactivate, or delete;
the last active admin can't be removed).

## Loading the existing data

`backend/data/` holds the data from the three Google-Sheet PDFs and the 24 team logins:

```bash
npm run seed -- --dry     # check the files only (no database needed)
npm run seed              # 24 people + 2,895 leads + 6,202 call-history entries
npm run seed -- --reset   # re-import only the leads that came from the import
```

- Logins keep the passwords they had before (the hashes are carried over). Admins: Dolly, Fara, Nitin Sachdeva, Tanvi Negi.
- Day 1 attendees: 706 · Day 2 attendees: 634 · leads in more than one sheet are merged by phone number.
- Callers named in the sheets but without a login (Harpreet, Niyati, Naina, Prerna, Vandna) are visible to admins only
  until you add them on **Team** with exactly that **caller name**.
- Live leads (from the intake sheet) are never touched by the seed.

## Daily flow

**The Google Sheet** has these columns:

| Typed by the morning person | Filled by the website |
|---|---|
| Timestamp · Lead Name · Lead Email · Lead Phone · UTW Date · Assigned To | Level · Profession · City |

1. **One-time connection** (Settings → *Google Sheet ↔ website*): generate a secret key → save → *Copy Apps Script* →
   in the sheet open *Extensions → Apps Script*, paste, run `setupSheet` once (it sets up **every lead tab**), *Deploy → Web app* (Execute as *Me*,
   access *Anyone*) → paste the Web app URL in Settings → *Test connection*. The sheet stays **private**; only that URL
   plus the secret key can read it. (Script source: `backend/sheet/Code.gs`.)
   **All tabs are read:** any tab with a `Lead Name` + `Lead Phone` header row (columns may be in any order). Tabs starting with `_`, hidden tabs and tabs without those headers are ignored; run `checkTabs` in Apps Script to see which. Level / Profession / City are written back into the tab the lead is in.
2. Each morning the person adds rows. The server imports every 5 minutes (or press **Import from sheet**), plans
   Follow-up 1/2/3 and shows them on the assigned caller's **My Tasks**. Re-import never duplicates (phone = unique),
   and blank cells never wipe existing data. Blank *Assigned To* = auto-assigned.
3. A caller taps **Call / WhatsApp**, then **Update status** — picks the outcome, adds Level / Profession / City and a note.
   Level / Profession / City are written back to the **same row** of the Google Sheet within seconds
   (failed write-backs retry every 5 minutes; what a caller typed is never overwritten by an older sheet value).
4. Admins use the **Daily Board**, **Reports** (CSV export), bulk re-assign, attendance and Settings.

### Caller view (My Tasks)
Callers get a calm screen: a greeting, a small batch of people to call, and only three buttons — **Call**, **WhatsApp**,
**Update status**. Phone numbers are not displayed anywhere for callers (tasks, Leads, Attendance, Activity), and there are no
red "overdue" counters. Admins keep the full detail. *(Numbers are hidden on screen; the Call / WhatsApp buttons still
need them internally to dial.)*

Automations (all in Settings): auto-import, round-robin assignment, auto-retry (DNP → next follow-up pulled forward),
auto-close (Not interested / Wrong number cancels the rest), overdue escalation to admin, WhatsApp message template,
nightly snapshot kept forever. Follow-up times, working hours and "today" are in **India time**
(`TZ_OFFSET_MIN=330`) even when the server runs in UTC.

**Settings → Demo data** adds ~200 made-up leads (with ~10 months of history) over your existing callers so you can
try Reports and the Board; **Clear demo** removes only those.

## Deploying (same as the Reminder List app)

- **Backend (Render)**: root `backend`, build `npm install`, start `npm start`. Env: `MONGO_URI`, `JWT_SECRET`,
  `FRONTEND_URL` (your Vercel URL). On Render the server pings itself every 10 minutes so the free tier doesn't sleep.
- **Frontend (Vercel)**: root `frontend`, framework Vite. Env: `VITE_API_URL=https://<your-backend>.onrender.com/api`.
  `vercel.json` already rewrites all routes to the app.

## API

All under `/api`, JSON, `Authorization: Bearer <token>`.
`POST /auth/login` · `GET /auth/me` · `PUT /auth/me` · `POST /auth/change-password` ·
`GET|POST /leads` · `PATCH /leads/:id` · `PATCH /leads/:id/fu/:n` · `POST /leads/bulk-assign` · `POST /attendance` ·
`GET /activity` · `GET /reports?months=` · `GET /config` · `PUT /config` (admin) · `POST /sync` (admin) ·
`GET /today`, `GET /daily`, `POST /snapshot` (admin) · `GET|POST|PUT|DELETE /team` (admin) · `POST|DELETE /demo` (admin).
