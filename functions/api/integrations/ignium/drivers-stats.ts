type Context = {
  request: Request;
  env: {
    DB: D1Database;
    IGNIUM_ALLOWED_ORIGIN?: string;
    IGNIUM_INTEGRATION_TOKEN?: string;
    INTERNAL_API_TOKEN?: string;
  };
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function parseOriginHeader(value: string | null): string | null {
  if (!value) return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function hasAllowedOrigin(request: Request, allowedOrigin: string | undefined): boolean {
  if (!allowedOrigin) return false;

  const explicitOrigin = parseOriginHeader(request.headers.get("x-ignium-origin"));
  const origin = parseOriginHeader(request.headers.get("origin"));
  const referer = parseOriginHeader(request.headers.get("referer"));
  return explicitOrigin === allowedOrigin || origin === allowedOrigin || referer === allowedOrigin;
}

type DriverStat = {
  iracing_customer_id: number;
  display_name: string;
  last_seen_at: string | null;
  total_sessions: number;
  latest_session_id: string | null;
  latest_series: string | null;
  latest_track: string | null;
  latest_finish_position: number | null;
  best_finish_position: number | null;
  total_results: number;
};

export async function onRequestGet(context: Context) {
  const expectedToken = context.env.IGNIUM_INTEGRATION_TOKEN ?? context.env.INTERNAL_API_TOKEN;
  const authHeader = context.request.headers.get("authorization") ?? "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : null;

  if (bearer && expectedToken && bearer === expectedToken) {
    // Explicit token auth still works.
  } else if (!hasAllowedOrigin(context.request, context.env.IGNIUM_ALLOWED_ORIGIN)) {
    return json({ ok: false, error: "forbidden_origin" }, 403);
  }

  const urlParams = new URL(context.request.url).searchParams;
  const customerIds = urlParams.get("customerIds")?.split(",").filter(Boolean) ?? [];

  if (!customerIds.length) {
    return json({ ok: false, error: "customerIds required (comma-separated)" }, 400);
  }

  try {
    const stats = await context.env.DB.prepare(
      `
      SELECT
        d.iracing_member_id as iracing_customer_id,
        d.display_name,
        d.last_seen_at,
        COUNT(DISTINCT sp.iracing_session_id) as total_sessions,
        MAX(s.iracing_session_id) as latest_session_id,
        (SELECT s2.series_name FROM sessions s2 
         WHERE s2.iracing_session_id = MAX(s.iracing_session_id)) as latest_series,
        (SELECT s2.track_name FROM sessions s2 
         WHERE s2.iracing_session_id = MAX(s.iracing_session_id)) as latest_track,
        (SELECT sp2.finish_pos FROM session_participants sp2 
         WHERE sp2.iracing_session_id = MAX(s.iracing_session_id) 
         AND sp2.iracing_member_id = d.iracing_member_id) as latest_finish_position,
        MIN(sp.finish_pos) as best_finish_position,
        COUNT(*) as total_results
      FROM drivers d
      LEFT JOIN session_participants sp ON d.iracing_member_id = sp.iracing_member_id
      LEFT JOIN sessions s ON sp.iracing_session_id = s.iracing_session_id
      WHERE d.iracing_member_id IN (${customerIds.map(() => "?").join(",")})
      GROUP BY d.iracing_member_id, d.display_name, d.last_seen_at
      `
    )
      .bind(...customerIds.map(Number))
      .all();

    return json({ 
      ok: true, 
      drivers: (stats.results ?? []) as DriverStat[] 
    });
  } catch (err) {
    return json(
      { ok: false, error: "query_failed", message: err instanceof Error ? err.message : "Unknown error" },
      500
    );
  }
}
