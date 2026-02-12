function nowIso() {
  return new Date().toISOString();
}

function uuid() {
  return crypto.randomUUID();
}

async function runSeed(context: any) {
  const { DB } = context.env;

  // Simple safety: only allow on .pages.dev or when explicitly enabled
  const host = new URL(context.request.url).host;
  const isPreview = host.endsWith(".pages.dev");
  const allow = context.env?.ALLOW_DEV_SEED === "true";

  if (!isPreview && !allow) {
    return new Response("Seed disabled", { status: 403 });
  }

  const t = nowIso();

  // Drivers
  const drivers = [
    { id: "1001", name: "BudgetDadRacing" },
    { id: "1002", name: "CleanBattleLarry" },
    { id: "1003", name: "BlueFlagBenny" },
  ];

  for (const d of drivers) {
    await DB.prepare(
      `INSERT OR REPLACE INTO drivers (iracing_member_id, display_name, last_seen_at)
       VALUES (?, ?, ?)`
    )
      .bind(d.id, d.name, t)
      .run();
  }

  // Session
  const sessionId = "900001";
  await DB.prepare(
    `INSERT OR REPLACE INTO sessions (iracing_session_id, start_time, series_name, track_name, split, sof)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(sessionId, t, "F4 Fixed", "Okayama", 3, 1623)
    .run();

  // Participants
  const participants = [
    { id: "1001", pos: 2, car: "F4" },
    { id: "1002", pos: 3, car: "F4" },
    { id: "1003", pos: 9, car: "F4" },
  ];

  for (const p of participants) {
    await DB.prepare(
      `INSERT OR REPLACE INTO session_participants
       (iracing_session_id, iracing_member_id, finish_pos, car_name)
       VALUES (?, ?, ?, ?)`
    )
      .bind(sessionId, p.id, p.pos, p.car)
      .run();
  }

  // Create a fake verified user (dev)
  const userId = uuid();
  await DB.prepare(
    `INSERT OR REPLACE INTO users (id, iracing_member_id, display_name, created_at)
     VALUES (?, ?, ?, ?)`
  )
    .bind(userId, "1001", "BudgetDadRacing", t)
    .run();

  // Props (dev)
  const props = [
    { to: "1002", reason: "clean_battle" },
    { to: "1002", reason: "respectful_driving" },
    { to: "1003", reason: "good_etiquette" },
  ];

  for (const p of props) {
    await DB.prepare(
      `INSERT OR IGNORE INTO props (id, iracing_session_id, to_iracing_member_id, from_user_id, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(uuid(), sessionId, p.to, userId, p.reason, t)
      .run();
  }

  return Response.json({ ok: true, sessionId, drivers });
}

export async function onRequestPost(context: any) {
  return runSeed(context);
}

export async function onRequestGet(context: any) {
  return runSeed(context);
}
