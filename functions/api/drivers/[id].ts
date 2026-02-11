export async function onRequestGet(context: any) {
  const id = context.params.id as string;
  const { DB } = context.env;

  const driver = await DB.prepare(
    `SELECT iracing_member_id as id, display_name as name
     FROM drivers WHERE iracing_member_id = ?`
  ).bind(id).first();

  const propsRow = await DB.prepare(
    `SELECT COUNT(*) as c FROM props WHERE to_iracing_member_id = ?`
  ).bind(id).first();

  const byReason = await DB.prepare(
    `SELECT reason, COUNT(*) as c
     FROM props WHERE to_iracing_member_id = ?
     GROUP BY reason`
  ).bind(id).all();

  const propsByReason: Record<string, number> = {};
  for (const r of byReason.results ?? []) propsByReason[r.reason] = r.c;

  const sessions = await DB.prepare(
    `
    SELECT s.iracing_session_id as sessionId,
           s.start_time as startTime,
           s.series_name as seriesName,
           s.track_name as trackName,
           sp.finish_pos as finishPos
    FROM session_participants sp
    JOIN sessions s ON s.iracing_session_id = sp.iracing_session_id
    WHERE sp.iracing_member_id = ?
    ORDER BY s.start_time DESC
    LIMIT 5
    `
  ).bind(id).all();

  return Response.json(
    {
      id,
      name: driver?.name ?? `Driver ${id}`,
      propsReceived: propsRow?.c ?? 0,
      propsByReason,
      recentSessions: sessions.results ?? [],
    },
    { headers: { "Cache-Control": "public, max-age=60" } }
  );
}
