import { getViewer, getValidAccessToken } from "../../_lib/auth";
import { iracingDataGet } from "../../_lib/iracing";

async function importIfNeeded(context: any, sessionId: string) {
  const { DB } = context.env;

  const exists = await DB.prepare(
    `SELECT 1 FROM sessions WHERE iracing_session_id = ?`
  ).bind(sessionId).first();

  if (exists) return;

  const viewer = await getViewer(context);
  if (!viewer.verified) {
    // Not cached and not verified -> block
    const err = new Response("Session not cached. Verify to load.", { status: 404 });
    // add a hint header for UI if you want
    err.headers.set("X-GridRep-Auth-Required", "1");
    throw err;
  }

  const accessToken = await getValidAccessToken(context, viewer.user!.id);

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

export async function onRequestGet(context: any) {
  const sessionId = String(context.params.id);
  const { DB } = context.env;

  try {
    await importIfNeeded(context, sessionId);
  } catch (e: any) {
    if (e instanceof Response) return e;
    return new Response(String(e?.message ?? "Import error"), { status: 500 });
  }

  const session = await DB.prepare(
    `SELECT iracing_session_id as sessionId, start_time as startTime, series_name as seriesName, track_name as trackName
     FROM sessions WHERE iracing_session_id = ?`
  ).bind(sessionId).first();

  const participants = await DB.prepare(
    `SELECT
        d.iracing_member_id as id,
        d.display_name as name,
        sp.finish_pos as finishPos,
        sp.car_name as carName,
        (SELECT COUNT(*) FROM props p WHERE p.iracing_session_id = sp.iracing_session_id AND p.to_iracing_member_id = d.iracing_member_id) as props
     FROM session_participants sp
     JOIN drivers d ON d.iracing_member_id = sp.iracing_member_id
     WHERE sp.iracing_session_id = ?
     ORDER BY sp.finish_pos ASC`
  ).bind(sessionId).all();

  const viewer = await getViewer(context);

  // Find which drivers this viewer already propped in this session
  const already = new Set<string>();
  if (viewer.verified) {
    const rows = await DB.prepare(
      `SELECT to_iracing_member_id as toId
       FROM props
       WHERE iracing_session_id = ? AND from_user_id = ?`
    ).bind(sessionId, viewer.user!.id).all();

    for (const r of rows.results ?? []) already.add(String((r as any).toId));
  }

  return Response.json(
    {
      sessionId,
      startTime: session?.startTime ?? new Date(0).toISOString(),
      seriesName: session?.seriesName,
      trackName: session?.trackName,
      participants: (participants.results ?? []).map((p: any) => ({
        ...p,
        alreadyPropped: already.has(String(p.id)),
      })),
      viewer: { verified: viewer.verified },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
