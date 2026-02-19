export async function onRequestGet(context: any) {
  const id = String(context.params.id);
  const { DB } = context.env;

  // Driver must exist in cache (drivers table) to be a valid profile.
  const driver = await DB.prepare(
    `SELECT iracing_member_id as id, display_name as name
     FROM drivers
     WHERE iracing_member_id = ?`
  )
    .bind(id)
    .first<any>();

  if (!driver?.id) {
    return new Response(
      `Driver ${id} not found in cache yet. Open a session that includes them and try again.`,
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }

  const propsRow = await DB.prepare(
    `SELECT COUNT(*) as c
     FROM props
     WHERE to_iracing_member_id = ?`
  )
    .bind(id)
    .first<any>();

  const byReason = await DB.prepare(
    `SELECT reason, COUNT(*) as c
     FROM props
     WHERE to_iracing_member_id = ?
     GROUP BY reason`
  )
    .bind(id)
    .all<any>();

  const propsByReason: Record<string, number> = {};
  for (const r of byReason.results ?? []) {
    propsByReason[String(r.reason)] = Number(r.c ?? 0);
  }

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
  )
    .bind(id)
    .all<any>();

  // Recent props received (latest 20)
  // We resolve "from" via users -> drivers (if the sender's driver record is cached).
  const recentProps = await DB.prepare(
    `
    SELECT
      p.created_at as createdAt,
      p.reason as reason,
      p.iracing_session_id as sessionId,

      s.series_name as seriesName,
      s.track_name as trackName,

      dFrom.iracing_member_id as fromDriverId,
      dFrom.display_name as fromName

    FROM props p
    LEFT JOIN sessions s ON s.iracing_session_id = p.iracing_session_id

    LEFT JOIN users uFrom ON uFrom.id = p.from_user_id
    LEFT JOIN drivers dFrom ON dFrom.iracing_member_id = uFrom.iracing_member_id

    WHERE p.to_iracing_member_id = ?
    ORDER BY datetime(p.created_at) DESC
    LIMIT 20
    `
  )
    .bind(id)
    .all<any>();

  return Response.json(
    {
      id: String(driver.id),
      name: String(driver.name),
      propsReceived: Number(propsRow?.c ?? 0),
      propsByReason,
      recentSessions: sessions.results ?? [],
      recentPropsReceived: recentProps.results ?? [],
    },
    { headers: { "Cache-Control": "public, max-age=60" } }
  );
}
