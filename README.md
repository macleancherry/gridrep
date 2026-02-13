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
│  └─ styles.css             # global styles (clean “racing UI” theme)
│
├─ functions/                # Cloudflare Pages Functions (API)
│  └─ api/
│     ├─ drivers/            # driver endpoints
│     ├─ sessions/           # session endpoints
│     ├─ leaderboard.ts      # leaderboard endpoint
│     ├─ props.ts            # send props endpoint
│     └─ dev/seed.ts         # dev/demo seeding (disabled by default)
│
├─ migrations/               # D1 migrations (schema)
│  └─ 0001_init.sql
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
