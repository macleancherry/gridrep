export async function onRequestGet(context: any) {
  const { DB } = context.env;

  const url = new URL(context.request.url);
  const q = (url.searchParams.get("q") || "").trim();

  if (!q) return Response.json({ results: [] });

  // Case-insensitive "contains" match
  const like = `%${q.toLowerCase()}%`;

  const rows = await DB.prepare(
    `
    SELECT
      d.iracing_member_id as id,
      d.display_name as name,
      (
        SELECT COUNT(*)
        FROM props p
        WHERE p.to_iracing_member_id = d.iracing_member_id
      ) as propsReceived
    FROM drivers d
    WHERE LOWER(d.display_name) LIKE ?
       OR CAST(d.iracing_member_id AS TEXT) LIKE ?
    ORDER BY propsReceived DESC, d.display_name ASC
    LIMIT 20
    `
  ).bind(like, `%${q}%`).all();

  return Response.json({ results: rows.results ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
