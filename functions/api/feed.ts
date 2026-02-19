export async function onRequestGet(context: any) {
  const { DB } = context.env;

  const rows = await DB.prepare(
    `
    SELECT
      p.created_at as createdAt,
      p.reason as reason,
      p.iracing_session_id as sessionId,

      s.series_name as seriesName,
      s.track_name as trackName,

      p.to_iracing_member_id as toDriverId,
      dTo.display_name as toName,

      dFrom.iracing_member_id as fromDriverId,
      dFrom.display_name as fromName

    FROM props p
    LEFT JOIN sessions s ON s.iracing_session_id = p.iracing_session_id
    LEFT JOIN drivers dTo ON dTo.iracing_member_id = p.to_iracing_member_id

    LEFT JOIN users u ON u.id = p.from_user_id
    LEFT JOIN drivers dFrom ON dFrom.iracing_member_id = u.iracing_member_id

    ORDER BY datetime(p.created_at) DESC
    LIMIT 20
    `
  ).all();

  return Response.json({ results: rows.results ?? [] }, { headers: { "Cache-Control": "public, max-age=10" } });
}
