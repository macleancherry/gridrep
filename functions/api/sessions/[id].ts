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

  return Response.json(
    {
      sessionId,
      startTime: session?.startTime ?? new Date(0).toISOString(),
      seriesName: session?.seriesName,
      trackName: session?.trackName,
      participants: (participants.results ?? []).map((p: any) => ({ ...p, alreadyPropped: false })),
      viewer: { verified: false },
    },
    { headers: { "Cache-Control": "public, max-age=60" } }
  );
}
