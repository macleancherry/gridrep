import { refreshRecentRacesForMember } from "../../../_lib/recent";

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
  avg_finish_position: number | null;
  wins: number;
  podiums: number;
  top_fives: number;
  latest_session_id: string | null;
  latest_series: string | null;
  latest_track: string | null;
  latest_finish_position: number | null;
  best_finish_position: number | null;
  favorite_track: string | null;
  favorite_series: string | null;
  total_results: number;
  irating: number | null;
  license_class: string | null;
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
  const limitRaw = Number(urlParams.get("limit") ?? "100");
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(250, Math.trunc(limitRaw))) : 100;
  const refreshFlag = (urlParams.get("refresh") ?? "1").toLowerCase();
  const shouldRefresh = refreshFlag !== "0" && refreshFlag !== "false";

  if (!customerIds.length) {
    return json({ ok: false, error: "customerIds required (comma-separated)" }, 400);
  }

  try {
    if (shouldRefresh) {
      for (const customerId of customerIds) {
        await refreshRecentRacesForMember(context, customerId, limit);
      }
    }

    const stats = await context.env.DB.prepare(
      `
      WITH targets AS (
        SELECT value AS member_id
        FROM json_each(?)
      ),
      aggregate_stats AS (
        SELECT
          sp.iracing_member_id,
          COUNT(DISTINCT sp.iracing_session_id) as total_sessions,
          ROUND(AVG(CASE WHEN sp.finish_pos IS NOT NULL THEN sp.finish_pos END), 2) as avg_finish_position,
          SUM(CASE WHEN sp.finish_pos = 1 THEN 1 ELSE 0 END) as wins,
          SUM(CASE WHEN sp.finish_pos BETWEEN 1 AND 3 THEN 1 ELSE 0 END) as podiums,
          SUM(CASE WHEN sp.finish_pos BETWEEN 1 AND 5 THEN 1 ELSE 0 END) as top_fives,
          MIN(sp.finish_pos) as best_finish_position,
          COUNT(sp.iracing_session_id) as total_results
        FROM session_participants sp
        WHERE sp.iracing_member_id IN (SELECT member_id FROM targets)
        GROUP BY sp.iracing_member_id
      ),
      latest AS (
        SELECT
          sp.iracing_member_id,
          sp.iracing_session_id,
          sp.finish_pos,
          s.series_name,
          s.track_name,
          s.start_time,
          ROW_NUMBER() OVER (
            PARTITION BY sp.iracing_member_id
            ORDER BY datetime(s.start_time) DESC, sp.iracing_session_id DESC
          ) AS rn
        FROM session_participants sp
        JOIN sessions s ON s.iracing_session_id = sp.iracing_session_id
        WHERE sp.iracing_member_id IN (SELECT member_id FROM targets)
      ),
      latest_one AS (
        SELECT iracing_member_id, iracing_session_id, series_name, track_name, finish_pos
        FROM latest
        WHERE rn = 1
      ),
      favorite_track AS (
        SELECT
          sp.iracing_member_id,
          s.track_name,
          COUNT(*) AS c,
          ROW_NUMBER() OVER (
            PARTITION BY sp.iracing_member_id
            ORDER BY COUNT(*) DESC, MAX(datetime(s.start_time)) DESC
          ) AS rn
        FROM session_participants sp
        JOIN sessions s ON s.iracing_session_id = sp.iracing_session_id
        WHERE sp.iracing_member_id IN (SELECT member_id FROM targets)
          AND s.track_name IS NOT NULL
        GROUP BY sp.iracing_member_id, s.track_name
      ),
      favorite_track_one AS (
        SELECT iracing_member_id, track_name
        FROM favorite_track
        WHERE rn = 1
      ),
      favorite_series AS (
        SELECT
          sp.iracing_member_id,
          s.series_name,
          COUNT(*) AS c,
          ROW_NUMBER() OVER (
            PARTITION BY sp.iracing_member_id
            ORDER BY COUNT(*) DESC, MAX(datetime(s.start_time)) DESC
          ) AS rn
        FROM session_participants sp
        JOIN sessions s ON s.iracing_session_id = sp.iracing_session_id
        WHERE sp.iracing_member_id IN (SELECT member_id FROM targets)
          AND s.series_name IS NOT NULL
        GROUP BY sp.iracing_member_id, s.series_name
      ),
      favorite_series_one AS (
        SELECT iracing_member_id, series_name
        FROM favorite_series
        WHERE rn = 1
      )
      SELECT
        CAST(t.member_id AS INTEGER) as iracing_customer_id,
        COALESCE(d.display_name, 'Driver ' || t.member_id) as display_name,
        d.last_seen_at,
        COALESCE(a.total_sessions, 0) as total_sessions,
        a.avg_finish_position,
        COALESCE(a.wins, 0) as wins,
        COALESCE(a.podiums, 0) as podiums,
        COALESCE(a.top_fives, 0) as top_fives,
        l.iracing_session_id as latest_session_id,
        l.series_name as latest_series,
        l.track_name as latest_track,
        l.finish_pos as latest_finish_position,
        a.best_finish_position,
        ft.track_name as favorite_track,
        fs.series_name as favorite_series,
        COALESCE(a.total_results, 0) as total_results,
        d.irating as irating,
        d.license_class as license_class
      FROM targets t
      LEFT JOIN drivers d ON d.iracing_member_id = t.member_id
      LEFT JOIN aggregate_stats a ON a.iracing_member_id = t.member_id
      LEFT JOIN latest_one l ON l.iracing_member_id = t.member_id
      LEFT JOIN favorite_track_one ft ON ft.iracing_member_id = t.member_id
      LEFT JOIN favorite_series_one fs ON fs.iracing_member_id = t.member_id
      GROUP BY t.member_id, d.display_name, d.last_seen_at, a.total_sessions, a.avg_finish_position,
               a.wins, a.podiums, a.top_fives, l.iracing_session_id, l.series_name, l.track_name,
               l.finish_pos, a.best_finish_position, ft.track_name, fs.series_name, a.total_results
      `
    )
      .bind(JSON.stringify(customerIds.map((id) => String(id))))
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
