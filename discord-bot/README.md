# GridRep Discord Bot

A self-hosted clone of the [iRacing Reports](https://iracingreports.com) Discord bot: race announcements, driver/team stats, lap-pace and field-strength analytics, championship/league tracking, and admin setup commands — all commands unlocked, no subscription tier.

Deployed as an independent Cloudflare Worker (`gridrep-discord-bot`) that shares the main app's D1 database (`migrations/0031_discord_bot.sql` adds this bot's tables alongside GridRep's own schema).

## How it works

- **Slash commands** are handled via Discord's HTTP Interactions endpoint (`fetch()` in `src/index.ts`), not a persistent gateway connection — Workers can't hold one open. Every request is checked with Discord's Ed25519 signature before anything runs.
- **Race announcements** are driven by a Cron Trigger (`scheduled()`, every 2 minutes) that polls each tracked driver's recent races and posts new results to the configured channel.
- **iRacing data** comes from the same OAuth PKCE client GridRep's web app uses (`functions/_lib/iracing.ts`), authenticated as a single "service" iRacing account (see setup below) rather than per-Discord-user consent, since the bot looks up arbitrary drivers/series, not just the account holder's own data.
- **Charts** (lap pace, heatmaps) are rendered via [QuickChart.io](https://quickchart.io); see "Self-hosting charts" below to avoid the external call.

## One-time setup

### 1. Create the Discord application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) → New Application.
2. Under **Bot**, create a bot user and copy its token (`DISCORD_BOT_TOKEN`).
3. On the application's main page, copy the **Public Key** (`DISCORD_PUBLIC_KEY`) and **Application ID** (`DISCORD_APPLICATION_ID`).
4. Under **OAuth2 → URL Generator**, select the `bot` and `applications.commands` scopes and the `Send Messages` / `Embed Links` permissions, then use the generated URL to invite the bot to your server.
5. Once the Worker is deployed (step 4 below), set **Interactions Endpoint URL** on the application page to `https://<your-worker>.<your-subdomain>.workers.dev`.

### 2. Authorize the bot's iRacing service account

The bot needs one authenticated iRacing account to query the Data API on behalf of any driver. Easiest path: reuse GridRep's existing OAuth flow.

1. Make sure `IRACING_CLIENT_ID` / `IRACING_CLIENT_SECRET` / `IRACING_REDIRECT_URI` are the same values configured for the main app (or register a second OAuth application with iRacing if you'd rather keep them separate).
2. Sign in through the main app's `/api/auth/start` flow using the iRacing account you want the bot to run as.
3. After the callback completes, copy that account's `access_token` / `refresh_token` (from wherever the main app persists them) and seed `bot_service_tokens` once:

   ```sql
   INSERT INTO bot_service_tokens (id, access_token, refresh_token, expires_at)
   VALUES (1, '<access_token>', '<refresh_token>', '<ISO 8601 expiry>');
   ```

   Run via `wrangler d1 execute gridrep --remote --command "..."` (or `--local` for `wrangler dev`). After this the bot refreshes the token itself indefinitely.

### 3. Configure secrets and deploy

```sh
cd discord-bot
npm install

wrangler secret put DISCORD_PUBLIC_KEY
wrangler secret put DISCORD_BOT_TOKEN
wrangler secret put DISCORD_APPLICATION_ID
wrangler secret put IRACING_CLIENT_ID
wrangler secret put IRACING_CLIENT_SECRET
wrangler secret put IRACING_REDIRECT_URI

npm run deploy
```

### 4. Apply the migration and register commands

```sh
# From the repo root, against the shared D1 database:
wrangler d1 migrations apply gridrep --remote

# From discord-bot/:
DISCORD_APPLICATION_ID=... DISCORD_BOT_TOKEN=... npm run register-commands
```

### 5. Configure your server

In Discord, an admin runs:

```
/setup admin_role role:@RaceAdmins
/setup results_announcer channel:#race-results
/manage_team add driver:"Your Name"
```

See `/setup` and `/manage_team` for the full set of admin commands, and `src/discord/commandDefs.ts` for every command's exact options.

## Local development

```sh
npm run dev            # wrangler dev, binds to a local D1 replica (--local)
npm run typecheck
```

To exercise a command locally you'll need to sign requests like Discord does (Ed25519 over `timestamp + body`) — the simplest path is deploying to a real Worker and testing from an actual Discord server, since Discord won't send interactions to `localhost`.

## Self-hosting charts

By default, `/laps`, `/officials`, `/participation`, `/strengthoffield`, `/balance`, `/championship`, and `/popularity` render chart images via `https://quickchart.io/chart`. If you'd rather not depend on an external service, run [QuickChart's own open-source Docker image](https://quickchart.io/documentation/self-hosting/) and pass its base URL to `buildChartUrl`/`buildBarChart`/`buildHeatmap` in `src/lib/charts.ts` (add a `QUICKCHART_BASE_URL` secret and thread it through — the URL shape QuickChart expects is identical either way).

## Known limitations vs. the original bot

- `/laps` and `/balance` approximate pace/car-balance from season standings aggregates (average finish/start position, points) rather than raw lap times, since the Data API's season-standings endpoints don't expose per-lap data and this bot doesn't run its own results-ingestion warehouse.
- `/league track_stats` and league previous-race history are best-effort: iRacing's league endpoints are only lightly documented, so those calls degrade gracefully to a "no data" message if the response shape doesn't match.
- `/awards` reflects a driver's last ~10 official races, not career totals.
- `iracingGet()` (`src/lib/iracingAuth.ts`) only follows the single `{ link }` indirection every `/data/*` endpoint uses. It does **not** follow the second-level `chunk_info` pagination that large result sets (e.g. `search_hosted`, `lap_data`) use — see the root README's "iRacing Data API quirks" section, which the Pace product had to implement (`functions/_lib/paceIracing.ts`'s `getChunkInfo()`/`fetchChunkFileContents()`). None of this bot's endpoints are known to chunk today, but if a command starts returning empty results only for large series/leagues, that's the first thing to check.
