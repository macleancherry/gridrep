export async function onRequestGet(context: any) {
  const url = new URL(context.request.url);
  const window = url.searchParams.get("window") || "7d";
  const { DB } = context.env;

  const days = window === "30d" ? 30 : 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const rows = await DB.prepare(
    `
    SELECT d.iracing_member_id as id, d.display_name as name, COUNT(p.id) as props
    FROM props p
    JOIN drivers d ON d.iracing_member_id = p.to_iracing_member_id
    WHERE p.created_at >= ?
    GROUP BY d.iracing_member_id, d.display_name
    ORDER BY props DESC
    LIMIT 50
    `
  ).bind(since).all();

  return Response.json({ rows: rows.results ?? [] }, { headers: { "Cache-Control": "public, max-age=60" } });
}
