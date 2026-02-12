export async function onRequestGet(context: any) {
  const sessionId = context.params.id as string;
  const { DB } = context.env;

  const session = await DB.prepare(
    `SELECT iracing_session_id as sessionId, start_time as startTime, series_name as seriesName, track_name as trackName
     FROM sessions WHERE iracing_session_id = ?`
  ).bind(sessionId).first();

  const participants = await DB.prepare(
    `
    SELECT d.iracing_member_id as id,
           d.display_name as name,
           sp.finish_pos as finishPos,
           sp.car_name as carName,
           (SELECT COUNT(*) FROM props p
            WHERE p.iracing_session_id = sp.iracing_session_id
              AND p.to_iracing_member_id = d.iracing_member_id) as props
    FROM session_participants sp
    JOIN drivers d ON d.iracing_member_id = sp.iracing_member_id
    WHERE sp.iracing_session_id = ?
    ORDER BY sp.finish_pos ASC
    `
  ).bind(sessionId).all();

  // Dev “verified viewer”
  const viewerDriverId = context.env?.DEV_VIEWER_IRACING_ID ? String(context.env.DEV_VIEWER_IRACING_ID) : null;
  const verified = !!viewerDriverId;

  // If verified, find (or create) a users row so props can reference from_user_id
  let fromUserId: string | null = null;
  if (verified && viewerDriverId) {
    const existing = await DB.prepare(
      `SELECT id FROM users WHERE iracing_member_id = ?`
    ).bind(viewerDriverId).first();

    if (existing?.id) {
      fromUserId = existing.id;
    } else {
      const u = crypto.randomUUID();
      const dn = await DB.prepare(
        `SELECT display_name as name FROM drivers WHERE iracing_member_id = ?`
      ).bind(viewerDriverId).first();

      await DB.prepare(
        `INSERT INTO users (id, iracing_member_id, display_name, created_at) VALUES (?, ?, ?, ?)`
      ).bind(u, viewerDriverId, dn?.name ?? `Driver ${viewerDriverId}`, new Date().toISOString()).run();

      fromUserId = u;
    }
  }

  // Pull which drivers this viewer already propped in this session
  const already = new Set<string>();
  if (fromUserId) {
    const rows = await DB.prepare(
      `SELECT to_iracing_member_id as toId
       FROM props
       WHERE iracing_session_id = ? AND from_user_id = ?`
    ).bind(sessionId, fromUserId).all();

    for (const r of rows.results ?? []) already.add(r.toId);
  }

  return Response.json(
    {
      sessionId,
      startTime: session?.startTime ?? new Date(0).toISOString(),
      seriesName: session?.seriesName,
      trackName: session?.trackName,
      participants: (participants.results ?? []).map((p: any) => ({
        ...p,
        alreadyPropped: already.has(p.id),
      })),
      viewer: { verified },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
