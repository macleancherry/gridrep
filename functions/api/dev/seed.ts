function nowIso() {
  return new Date().toISOString();
}

function isoHoursAgo(hours: number) {
  const d = new Date(Date.now() - hours * 60 * 60 * 1000);
  return d.toISOString();
}

// Deterministic pseudo-random so seeding is stable (same data each run)
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, arr: T[]) {
  return arr[Math.floor(rng() * arr.length)];
}

function shuffle<T>(rng: () => number, arr: T[]) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function uuid() {
  return crypto.randomUUID();
}

export async function onRequestGet(context: any) {
  return onRequestPost(context);
}

export async function onRequestPost(context: any) {
  const DB = context.env?.DB;
  if (!DB) return new Response("DB binding missing", { status: 500 });

  // Safety gate: allow on pages.dev or explicit env var
  const host = new URL(context.request.url).host;
  const isPagesDev = host.endsWith(".pages.dev");
  const allow = context.env?.ALLOW_DEV_SEED === "true";
  if (!isPagesDev && !allow) return new Response("Seed disabled", { status: 403 });

  const rng = mulberry32(1337);
  const t = nowIso();

  // Optional: wipe existing seed-ish data (keeps demo consistent)
  // Comment out if you want to preserve real data.
  await DB.prepare(`DELETE FROM props`).run();
  await DB.prepare(`DELETE FROM session_participants`).run();
  await DB.prepare(`DELETE FROM sessions`).run();
  await DB.prepare(`DELETE FROM users`).run();
  await DB.prepare(`DELETE FROM drivers`).run();

  const firstNames = [
    "Alex","Sam","Jordan","Casey","Riley","Taylor","Morgan","Jamie","Chris","Dylan",
    "Kai","Avery","Cameron","Hayden","Bailey","Parker","Quinn","Jesse","Mason","Logan",
    "Noah","Luca","Theo","Ollie","Max","Leo","Ethan","Cooper","Finn","Zane",
  ];
  const lastWords = [
    "Apex","Draft","Slipstream","Kerb","Throttle","Braker","LateBraker","Racecraft","BlueFlag",
    "PitWindow","Stint","Overtake","Sweeper","Chicane","Hairpin","Sectors","Telemetry","TrackLimit",
    "CleanLine","Divebomb","FuelSaver","TrailBraker","Grid","Quali","Sof","Split","Laptime","Pace",
  ];
  const suffixes = ["Racing","Motorsport","Sim","Esports","GT","F4","LMU","iR",""];

  const cars = ["F4", "GT4", "GT3", "LMP3", "TCR"];
  const seriesPool = [
    { series: "F4 Fixed", cars: ["F4"] },
    { series: "GT4 Fixed", cars: ["GT4"] },
    { series: "IMSA Pilot Challenge", cars: ["GT4", "TCR"] },
    { series: "IMSA", cars: ["GT3", "LMP3"] },
    { series: "LMU Daily", cars: ["GT3"] },
    { series: "GT3 Sprint", cars: ["GT3"] },
  ];
  const tracks = [
    "Okayama","Oulton Park","Road Atlanta","Watkins Glen","Spa","Monza","Daytona Road",
    "Sebring","Hockenheim","Nürburgring GP","Zandvoort","Hungaroring",
  ];

  // Reasons must match your schema values
  const reasons = [
    "clean_battle",
    "respectful_driving",
    "great_racecraft",
    "good_etiquette",
    "helpful_friendly",
    "other",
  ] as const;

  // 1) Create a pool of drivers
  const driverCount = 60;
  const drivers: Array<{ id: string; name: string }> = [];

  for (let i = 0; i < driverCount; i++) {
    const id = String(1001 + i);
    const name =
      `${pick(rng, firstNames)}${pick(rng, lastWords)}` +
      (rng() < 0.45 ? ` ${pick(rng, suffixes)}` : "");
    drivers.push({ id, name: name.trim() });
  }

  // Keep your real username at 1001 if you want
  drivers[0] = { id: "1001", name: "BudgetDadRacing" };

  // Insert drivers
  for (const d of drivers) {
    await DB.prepare(
      `INSERT OR REPLACE INTO drivers (iracing_member_id, display_name, last_seen_at)
       VALUES (?, ?, ?)`
    ).bind(d.id, d.name, t).run();
  }

  // 2) Create a handful of verified users (who can give props)
  // We'll make 12 "verified" seed users mapped to existing drivers.
  const verifiers = shuffle(rng, drivers).slice(0, 12);
  const userIds: Array<{ userId: string; iracingId: string }> = [];

  for (const v of verifiers) {
    const userId = uuid();
    userIds.push({ userId, iracingId: v.id });

    await DB.prepare(
      `INSERT OR REPLACE INTO users (id, iracing_member_id, display_name, created_at)
       VALUES (?, ?, ?, ?)`
    ).bind(userId, v.id, v.name, t).run();
  }

  // 3) Create sessions with “full-ish” grids
  const sessionCount = 8;
  const sessions: Array<{ sessionId: string; start: string }> = [];

  for (let s = 0; s < sessionCount; s++) {
    const sessionId = String(900001 + s);
    const meta = pick(rng, seriesPool);
    const track = pick(rng, tracks);
    const split = 1 + Math.floor(rng() * 6);
    const sof = 1100 + Math.floor(rng() * 2200);
    const start = isoHoursAgo(3 + s * 6); // spaced out in time

    await DB.prepare(
      `INSERT OR REPLACE INTO sessions
       (iracing_session_id, start_time, series_name, track_name, split, sof)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(sessionId, start, meta.series, track, split, sof).run();

    // Participants per session
    const gridSize = 16 + Math.floor(rng() * 10); // 16–25
    const grid = shuffle(rng, drivers).slice(0, gridSize);

    // Assign positions 1..gridSize and cars
    for (let i = 0; i < grid.length; i++) {
      const p = grid[i];
      const finishPos = i + 1;
      const carName = pick(rng, meta.cars);

      await DB.prepare(
        `INSERT OR REPLACE INTO session_participants
         (iracing_session_id, iracing_member_id, finish_pos, car_name)
         VALUES (?, ?, ?, ?)`
      ).bind(sessionId, p.id, finishPos, carName).run();
    }

    sessions.push({ sessionId, start });
  }

  // 4) Props: realistic volume spread
  // Rules of thumb:
  // - ~40–80 props across all sessions
  // - Mostly to mid-pack drivers (people you battled)
  let propsInserted = 0;

  for (const s of sessions) {
    // pick a few “givers” who were in this session (and are verified users)
    const giversInSession = shuffle(rng, userIds).slice(0, 4);

    // pull participants list for this session (so we only prop people in that race)
    const part = await DB.prepare(
      `SELECT iracing_member_id as id, finish_pos as pos
       FROM session_participants
       WHERE iracing_session_id = ?
       ORDER BY finish_pos ASC`
    ).bind(s.sessionId).all();

    const participants = (part.results ?? []) as Array<{ id: string; pos: number }>;
    if (participants.length < 6) continue;

    // give 6–14 props per session
    const propsThisSession = 6 + Math.floor(rng() * 9);

    for (let i = 0; i < propsThisSession; i++) {
      const giver = pick(rng, giversInSession);

      // bias recipients toward positions 2–12
      const candidates = participants.slice(1, Math.min(12, participants.length));
      const to = pick(rng, candidates);

      // avoid self-props
      if (to.id === giver.iracingId) continue;

      const reason = pick(rng, [...reasons]);

      await DB.prepare(
        `INSERT OR IGNORE INTO props
         (id, iracing_session_id, to_iracing_member_id, from_user_id, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(uuid(), s.sessionId, to.id, giver.userId, reason, s.start).run();

      propsInserted++;
    }
  }

  return Response.json({
    ok: true,
    drivers: driverCount,
    sessions: sessionCount,
    props: propsInserted,
    exampleSearch: ["BudgetDad", "1001", drivers[10].name.split(" ")[0]],
  });
}
