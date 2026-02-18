import { getViewer, getValidAccessToken } from "../_lib/auth";
import { iracingDataGet } from "../_lib/iracing";

const ALLOWED_REASONS = new Set([
  "clean_battle",
  "respectful_driving",
  "great_racecraft",
  "good_etiquette",
  "helpful_friendly",
  "other",
]);

async function ensureSessionCached(context: any, sessionId: string, accessToken: string) {
  const { DB } = context.env;

  const exists = await DB.prepare(`SELECT 1 FROM sessions WHERE iracing_session_id = ?`).bind(sessionId).first();
  if (exists) return;

  const data: any = await iracingDataGet(
    `/data/results/get?subsession_id=${encodeURIComponent(sessionId)}&include_licenses=false`,
    accessToken
  );

  const startTime = data?.start_time ?? data?.subsession_start_time ?? new Date().toISOString();
  const seriesName = data?.series_name ?? data?.series?.series_name ?? null;
  const trackName = data?.track?.track_name ?? data?.track_name ?? null;
  const split = data?.split ?? null;
  const sof = data?.sof ?? data?.strength_of_field ?? null;

  await DB.prepare(
    `INSERT INTO sessions (iracing_session_id, start_time, series_name, track_name, split, sof)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(iracing_session_id) DO UPDATE SET
       start_time=excluded.start_time,
       series_name=excluded.series_name,
       track_name=excluded.track_name,
       split=excluded.split,
       sof=excluded.sof`
  ).bind(sessionId, startTime, seriesName, trackName, split, sof).run();

  const participants =
    data?.session_results ??
    data?.results ??
    data?.drivers ??
    data?.rows ??
    [];

  if (Array.isArray(participants)) {
    for (const p of participants) {
      const memberId = p?.cust_id ?? p?.iracing_member_id ?? p?.member_id ?? p?.driver?.cust_id;
      if (!memberId) continue;

      const displayName = p?.display_name ?? p?.displayname ?? p?.driver_name ?? p?.name ?? p?.driver?.display_name ?? `Driver ${memberId}`;
      const finishPos = p?.finish_pos ?? p?.finish_position ?? p?.pos ?? null;
      const carName = p?.car_name ?? p?.car?.car_name ?? p?.car ?? null;

      const now = new Date().toISOString();

      await DB.prepare(
        `INSERT INTO drivers (iracing_member_id, display_name, last_seen_at)
         VALUES (?, ?, ?)
         ON CONFLICT(iracing_member_id) DO UPDATE SET
           display_name=excluded.display_name,
           last_seen_at=excluded.last_seen_at`
      ).bind(String(memberId), displayName, now).run();

      await DB.prepare(
        `INSERT INTO session_participants (iracing_session_id, iracing_member_id, finish_pos, car_name)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(iracing_session_id, iracing_member_id) DO UPDATE SET
           finish_pos=excluded.finish_pos,
           car_name=excluded.car_name`
      ).bind(sessionId, String(memberId), finishPos, carName).run();
    }
  }
}

export async function onRequestPost(context: any) {
  const { DB } = context.env;

  const viewer = await getViewer(context);
  if (!viewer.verified) return new Response("Not verified", { status: 401 });

  const body = await context.request.json().catch(() => null);
  if (!body?.sessionId || !body?.toDriverId || !body?.reason) {
    return new Response("Missing fields", { status: 400 });
  }

  const sessionId = String(body.sessionId);
  const toDriverId = String(body.toDriverId);
  const reason = String(body.reason);

  if (!ALLOWED_REASONS.has(reason)) return new Response("Invalid reason", { status: 400 });
  if (toDriverId === viewer.user!.iracingId) return new Response("Cannot prop yourself", { status: 400 });

  // Ensure we have session + participants cached (auto-import)
  const accessToken = await getValidAccessToken(context, viewer.user!.id);
  await ensureSessionCached(context, sessionId, accessToken);

  // Must be a participant to send props
  const giverPart = await DB.prepare(
    `SELECT 1 FROM session_participants WHERE iracing_session_id = ? AND iracing_member_id = ?`
  ).bind(sessionId, viewer.user!.iracingId).first();
  if (!giverPart) return new Response("Viewer not in session", { status: 403 });

  // Recipient must be a participant
  const targetPart = await DB.prepare(
    `SELECT 1 FROM session_participants WHERE iracing_session_id = ? AND iracing_member_id = ?`
  ).bind(sessionId, toDriverId).first();
  if (!targetPart) return new Response("Target not in session", { status: 400 });

  // Insert (unique index already exists from 0001_init.sql)
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  try {
    await DB.prepare(
      `INSERT INTO props (id, iracing_session_id, to_iracing_member_id, from_user_id, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(id, sessionId, toDriverId, viewer.user!.id, reason, createdAt).run();
  } catch {
    return new Response("Already propped", { status: 409 });
  }

  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
