export async function onRequestGet(context: any) {
  const { request, env } = context;
  const { DB } = env;

  const url = new URL(request.url);
  const window = (url.searchParams.get("window") ?? "7d") as "7d" | "30d" | "all";

  let where = "";
  if (window === "7d") where = `WHERE datetime(p.created_at) >= datetime('now','-7 days')`;
  if (window === "30d") where = `WHERE datetime(p.created_at) >= datetime('now','-30 days')`;

  const rows = await DB.prepare(
    `
    SELECT
      d.iracing_member_id as id,
      d.display_name as name,
      COUNT(*) as propsReceived
    FROM props p
    JOIN drivers d ON d.iracing_member_id = p.to_iracing_member_id
    ${where}
    GROUP BY d.iracing_member_id, d.display_name
    ORDER BY propsReceived DESC, d.display_name ASC
    LIMIT 25
    `
  ).all();

  return Response.json({ results: rows.results ?? [] }, { headers: { "Cache-Control": "public, max-age=30" } });
}
