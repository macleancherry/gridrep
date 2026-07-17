# GridRep 🏁
**Props (GG) for clean racing.**

GridRep is a lightweight community tool for sim racing that lets drivers send **Props (GG)** after a race, with a reason (Clean battle, Respectful driving, etc.). Think “commendations” for racing — a visible carrot for good racecraft.

- Browse drivers and sessions without logging in
- Verify with iRacing OAuth to send Props (we never see your password)
- Props are limited to sessions you participated in
- One Prop per giver → recipient → session (anti-spam by design)

---

## Why this exists
Sim racing already has “stick” mechanics (penalties, protests, bans). GridRep is a simple “carrot” to reinforce clean, respectful racing and make it visible.

---

## Tech stack
- **Frontend:** React + TypeScript + Vite
- **Routing:** React Router
- **Hosting:** Cloudflare Pages
- **Backend:** Cloudflare Pages Functions
- **Database:** Cloudflare D1 (SQLite)
- **Auth:** iRacing OAuth (planned / in progress)

---

## Repo structure
```
/
├─ src/                      # React UI (Vite)
│  ├─ pages/                 # Home, Driver, Session, Leaderboard, About, Privacy
│  ├─ lib/                   # constants/helpers (eg. prop reasons)
│  ├─ styles.css             # global styles (clean “racing UI” theme)
│  └─ pace/                  # Pace: standalone iRacing pace product, mounted at /pace
│     ├─ pages/               # PaceHome (/pace), PaceSubsession (/pace/s/:id)
│     ├─ PaceLayout.tsx        # own header/shell, no shared Topbar/nav
│     └─ pace.css              # own light/minimal theme, scoped to .pace-shell
│
├─ functions/                # Cloudflare Pages Functions (API)
│  └─ api/
│     ├─ drivers/            # driver endpoints
│     ├─ sessions/           # session endpoints
│     ├─ leaderboard.ts      # leaderboard endpoint
│     ├─ props.ts            # send props endpoint
│     ├─ dev/seed.ts         # dev/demo seeding (disabled by default)
│     ├─ pace/                # Pace API - see "Pace" section below
│     └─ _lib/                 # paceIracing.ts, paceIngest.ts, cleanPace.ts, etc.
│
├─ migrations/               # D1 migrations (schema)
│  └─ 0001_init.sql … 0007_pace_subsession_complete.sql
│
├─ wrangler.toml             # local dev + D1 config
└─ package.json
```

---

## MVP product flow (today)
1. **Search** for a driver by iRacing name or ID
2. View driver profile:
   - total props received
   - props by reason
   - last 5 sessions
3. Open a session:
   - see grid (participants)
   - select a reason
   - give props to a driver (only if verified)

---

## Local development

### Prerequisites
- Node.js 18+ (20+ recommended)
- Git
- Cloudflare Wrangler (use via `npx wrangler`)

### Install
```bash
npm install
```

### Run locally (Vite + Pages Functions)
```bash
npm run build
npm run preview
```

This starts a local Pages environment (Wrangler) that serves both the UI and `/api/*` functions.
You’ll typically see something like: `http://localhost:8788`

---

## Database (D1)

### Apply migrations locally
```bash
npx wrangler d1 migrations apply gridrep
```

### Apply migrations to remote
```bash
npx wrangler d1 migrations apply gridrep --remote
```

### Inspect tables (remote)
```bash
npx wrangler d1 execute gridrep --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

---

## Demo / Seed data

A dev-only seed endpoint exists to populate a realistic dataset for demos.

### Enable seeding locally
Create a `.dev.vars` file in the repo root:
```ini
ALLOW_DEV_SEED=true
```

### Seed (local)
Open:
```
http://localhost:8788/api/dev/seed
```

### Seed (Cloudflare Pages)
Set `ALLOW_DEV_SEED=true` in:
**Cloudflare Pages → Settings → Variables and secrets**
(choose Production or Preview depending on which deployment URL you’re using)

Then open:
```
https://gridrep.pages.dev/api/dev/seed
```

> If you see Cloudflare **Error 1101**, it usually means the remote D1 migrations weren’t applied yet or the DB binding isn’t configured.

---

## Environment variables

### Required
- `DB` (D1 binding name in Cloudflare Pages)

### Optional
- `ALLOW_DEV_SEED=true`  
  Enables `/api/dev/seed` outside `.pages.dev` (use cautiously).
- `DEV_VIEWER_IRACING_ID=1001` (if supported in your branch)  
  Lets demo users behave as “verified” without OAuth.

---

## Deploying on Cloudflare Pages

1. Push to GitHub
2. Cloudflare Dashboard → **Pages** → Create project → Connect repo
3. Build settings:
   - Build command: `npm run build`
   - Output directory: `dist`
4. Bind D1:
   - Pages → Settings → Functions → D1 bindings
   - Variable name: `DB`
   - Database: `gridrep`

After first deploy, apply migrations to remote:
```bash
npx wrangler d1 migrations apply gridrep --remote
```

Then (optional) seed:
```
https://gridrep.pages.dev/api/dev/seed
```

---

## API overview (Pages Functions)

- `GET /api/drivers/search?q=...`  
  Search drivers by name (partial) or ID
- `GET /api/drivers/:id`  
  Driver profile + last 5 sessions + props summary
- `GET /api/sessions/:id`  
  Session details + participants + props counts + viewer state
- `POST /api/props`  
  Send props to another driver in the session (requires verification / demo mode)
- `GET /api/leaderboard?window=7d|30d`  
  Top props received in time window
- `POST/GET /api/dev/seed`  
  Populate demo data (dev only)

Pace's API (`/api/pace/*` — league sync, lap ingestion, clean-pace calculation) is documented in full in the [Pace](#pace--iracing-league-lap-sync--clean-pace-calculator) section below.

---

## Pace — iRacing league lap sync & clean-pace calculator

**Live at `/pace`.** Pace is a standalone product bolted onto GridRep — its own minimal light-theme UI (`src/pace/`, no shared nav/dark theme) and its own API namespace (`functions/api/pace/**`), but it rides on the same Cloudflare Pages + D1 deployment, the same iRacing OAuth login, and the same `drivers` table as the rest of GridRep. There is no separate iRacing service account: every Pace action runs as whichever verified GridRep user is signed in, using *their* iRacing OAuth token.

**What it does:** pulls qualifying + race lap-by-lap data for a hosted/league iRacing subsession via the iRacing Data API, and computes each driver's **clean pace** — the average of their best N non-incident laps (quali and race tracked independently, plus a combined "average pace" across whichever laps both used). Built for BoP / driver-lineup decisions (e.g. balancing endurance team rosters), where iRacing's own session average is skewed by pit stops and incidents.

### Data model

Three new tables (`migrations/0005_pace.sql`–`0007_pace_subsession_complete.sql`), reusing the existing `drivers` table (`iracing_member_id`, `display_name`) for driver identity — no separate driver table.

```sql
pace_leagues (
  league_id TEXT PRIMARY KEY,        -- iRacing's league_id
  name TEXT NOT NULL,
  last_synced_at TEXT,               -- ISO marker; only advances once a sync pass fully clears its backlog
  created_at TEXT NOT NULL,
  host_cust_id TEXT,                 -- see "Leagues (auto-discovery)" below - at least one of these two is required
  session_name_filter TEXT
)

pace_subsessions (
  subsession_id TEXT PRIMARY KEY,
  league_id TEXT,                    -- NULL for manually-pulled subsessions
  track_name TEXT,
  series_name TEXT,
  start_time TEXT,
  ingested_at TEXT NOT NULL,
  laps_complete INTEGER NOT NULL DEFAULT 0  -- 1 once every driver/sim-session pair has been fetched, no failures pending
)

pace_laps (
  subsession_id TEXT NOT NULL,
  cust_id TEXT NOT NULL,
  simsession_number INTEGER NOT NULL,  -- iRacing's own numbering: -1 = qualifying, 0 = race (this session's convention - not guaranteed universal)
  simsession_type TEXT NOT NULL,       -- normalized: 'qualifying' | 'race'
  lap_number INTEGER NOT NULL,
  lap_time_ms INTEGER,                 -- already normalized to milliseconds; NULL for laps with no time (out-laps, invalidated laps)
  flags_raw INTEGER,                   -- iRacing's raw `flags` bitmask, unparsed
  flags_decoded TEXT,                  -- JSON array of strings, e.g. ["off track"], ["invalid","pitted"] - iRacing's own `lap_events`
  is_pit_lap INTEGER NOT NULL DEFAULT 0,
  is_clean INTEGER,                    -- 1/0/NULL - NULL means "couldn't classify" (rare - see classifyLap below), not "assumed clean"
  created_at TEXT NOT NULL,
  PRIMARY KEY (subsession_id, cust_id, simsession_number, lap_number)
)
```

Raw flags are stored per lap specifically so the "what counts as clean" definition can change later and be recomputed from what's already stored, without re-hitting iRacing.

### API reference

All endpoints live under `/api/pace/*` and require a verified GridRep session (the `gr_session` httpOnly cookie set by the existing `/api/auth/*` OAuth flow) — same-origin browser requests only, there is **no bearer-token/allowed-origin integration path** for Pace the way `functions/api/integrations/ignium/*` has for driver stats. A separate service wanting this data today would need to either share the D1 database directly or a new integration endpoint would need to be added following that same pattern.

#### Subsessions

- **`POST /api/pace/subsessions/:subsessionId/sync`** — ingest (or continue ingesting) one subsession. Idempotent and **resumable**: Cloudflare Workers caps subrequests per invocation, so a large field (many drivers × 2 sim-sessions) can't always finish in one call. Each call fetches the result summary (first call only) and then a bounded batch of per-driver lap data (default 12 driver/sim-session pairs), skipping pairs already stored. Response:
  ```json
  {
    "ok": true,
    "subsessionId": "86989840",
    "simSessionsIngested": 2,
    "driversIngested": 60,
    "lapsIngested": 34,
    "driverFailures": [{ "custId": "...", "simsessionNumber": 0, "message": "..." }],
    "totalJobs": 120,
    "remainingJobs": 96,
    "emptyLapPayloadSample": "GET /data/results/lap_data?... -> {...}"
  }
  ```
  **Keep calling this endpoint until `remainingJobs` is `0`** — that's the whole ingestion for that subsession. `emptyLapPayloadSample` is only populated when a fetch succeeded but returned zero laps (diagnostic aid, not necessarily an error — a driver can legitimately have no laps in a sim-session).

- **`GET /api/pace/subsessions/:subsessionId`** — stored subsession + every raw lap row (`custId`, `driverName`, `simsessionNumber`, `simsessionType`, `lapNumber`, `lapTimeMs`, `isPitLap`, `isClean`, `flagsDecoded`). 404 if never synced.

- **`GET /api/pace/subsessions/:subsessionId/pace?qualLaps=1&raceLaps=5`** — computed pace, one row per driver:
  ```json
  {
    "ok": true, "subsessionId": "...", "qualLaps": 1, "raceLaps": 5,
    "drivers": [{
      "custId": "1291454", "driverName": "Mac Cherry",
      "qualifying": { "ok": true, "paceMs": 104000, "lapsUsed": 1, "n": 1, "partial": false, "lapTimesMs": [104000] },
      "race":       { "ok": true, "paceMs": 109080, "lapsUsed": 5, "n": 5, "partial": false, "lapTimesMs": [...] },
      "average":    { "ok": true, "paceMs": 108140, "lapsUsed": 6 },
      "incidents":  { "count": 2, "types": { "off track": 1, "contact": 1 } }
    }]
  }
  ```
  `qualLaps`/`raceLaps` default to **1** and **5** respectively (qualifying is conventionally a single flying lap). A pace result is computed from however many clean laps exist even if fewer than N (`partial: true` in that case) — it's only `{ "ok": false, "reason": "no_clean_laps" }` when there are *zero*. `average` combines the actual lap times qualifying/race used (not an average-of-averages). `incidents` counts non-pit laps carrying any flag, tallied by the literal flag string iRacing returned.

#### Leagues (auto-discovery)

- **`GET /api/pace/leagues`** — list followed leagues (`leagueId`, `name`, `lastSyncedAt`, `hostCustId`, `sessionNameFilter`).
- **`POST /api/pace/leagues`** `{ league_id, host_cust_id?, session_name_filter? }` — follow a league; validates via `/data/league/get`. **At least one of `host_cust_id`/`session_name_filter` is required** — see below for why.
- **`DELETE /api/pace/leagues/:leagueId`** — unfollow (does not delete already-ingested subsession data).
- **`POST /api/pace/sync`** — sync all followed leagues. Same subrequest constraint as subsession sync: **fully processes at most one subsession per call**. Response:
  ```json
  { "ok": true, "leaguesChecked": 1, "sessionsFound": 91, "sessionsIngested": 1, "sessionsRemaining": 90, "failures": [...], "emptySearchSamples": [...] }
  ```
  **Loop this endpoint until `sessionsRemaining` is `0`.** A league's `last_synced_at` only advances once every session discovered in that pass is confirmed fully ingested (`pace_subsessions.laps_complete = 1`) — advancing it any earlier would shrink the search window before the backlog is actually cleared and start silently missing sessions.

- **`GET /api/pace/debug/lap-data?subsessionId=&custId=&simsessionNumber=`** — diagnostic: raw `lap_data` call for one specific driver/sim-session, bypassing the batched multi-driver flow. Useful for isolating whether "0 laps" is real or a bug for one known-good driver.

### iRacing Data API quirks worth knowing (learned the hard way)

If another service is going to talk to iRacing's `/data` API directly rather than through Pace, these are the non-obvious things that cost real debugging time here:

- **Every `/data/*` call needs an initial fetch + a follow-up fetch.** The endpoint itself returns `{ "link": "https://...s3..." }`; the real payload is at that link. Handled by `functions/_lib/iracing.ts`'s `iracingDataGet()`.
- **Large list results are chunked a second time.** `search_hosted` and `lap_data` don't inline big result sets — the resolved payload has a `chunk_info: { base_download_url, chunk_file_names[] }`, and the actual rows live in those files (or `chunk_info` is `null`/`num_chunks: 0` when there's genuinely nothing). Missing this silently looks like "0 results" with no error. Handled by `getChunkInfo()`/`fetchChunkFileContents()` in `functions/_lib/paceIracing.ts`.
- **`/data/results/search_hosted` requires a "primary filter."** `league_id` alone 400s with `"One of the primary filters of host, driver, team, or session name must be included."` — confirmed live. It's only a secondary/narrowing filter; you must also pass `host_cust_id` and/or `session_name`. There's no "every hosted session for league X" query.
- **`lap_time` is in ten-thousandths of a second** (e.g. `1186863` → `118.6863s`), and `-1` is the sentinel for "no time" (out-laps, invalidated laps) — not a real negative time.
- **A clean lap's `lap_events` array is *empty*, not absent.** It's a required field on every lap row; `[]` itself is the "nothing wrong with this lap" signal. Treating "no items in the array" as "no signal at all" (rather than "confirmed clean") silently drops every clean lap from any average.
- **Cloudflare Workers cap subrequests per HTTP invocation** (~50 on this project's plan). A single lap-data pull, and each `/data/*` call within it, counts — a 60-driver field needs 120+ `lap_data` calls, which is why all bulk ingestion here is chunked into small resumable batches across multiple HTTP calls rather than done in one shot.

---

## Contributing

This is early-stage and we want help. If you’re keen:
1. Fork the repo
2. Create a branch: `feature/<name>`
3. Make changes (keep it small and readable)
4. Open a PR with a short explanation

### Good first issues
- UI polish & accessibility
- Leaderboard filters (series, track, timeframe)
- Better session browsing (more than last 5)
- Anti-abuse controls (rate limits, heuristics)
- More realistic seeding (cars, series, tracks)
- Overlay / telemetry integrations (future)

---

## Safety & anti-abuse principles
GridRep is designed to encourage clean racing **without becoming a moderation nightmare**:
- No free-text comments in MVP
- Props require verified identity (OAuth) for meaningful attribution
- One prop per giver/recipient/session
- Session participation required

---

## License
TBD

---

## Maintainer
GridRep is maintained by **BudgetDadRacing**.
Open an issue or PR if you want to contribute.
