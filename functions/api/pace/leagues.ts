import { getViewer, getValidAccessToken } from "../../_lib/auth";
import { getLeagueInfo, extractLeagueName, describeIracingError } from "../../_lib/paceIracing";
import { json, jsonError } from "../../_lib/httpJson";

function pickTrimmedString(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

export async function onRequestGet(context: any) {
  const { DB } = context.env;
  const rows = await DB.prepare(
    `SELECT league_id as leagueId, name, last_synced_at as lastSyncedAt, created_at as createdAt,
            host_cust_id as hostCustId, session_name_filter as sessionNameFilter
     FROM pace_leagues ORDER BY name ASC`
  ).all<any>();

  return json({ ok: true, leagues: rows.results ?? [] });
}

export async function onRequestPost(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required to follow a league." });
  }

  const body = await context.request.json().catch(() => null);
  const leagueId = typeof body?.league_id === "string" || typeof body?.league_id === "number" ? String(body.league_id) : null;
  const hostCustId = pickTrimmedString(body?.host_cust_id);
  const sessionNameFilter = pickTrimmedString(body?.session_name_filter);

  if (!leagueId) {
    return jsonError(400, { error: "invalid_league_id", message: "league_id is required." });
  }

  if (!hostCustId && !sessionNameFilter) {
    return jsonError(400, {
      error: "filter_required",
      message:
        "iRacing requires a host cust_id or a session-name filter to search hosted sessions for a league - provide at least one.",
    });
  }

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(context, viewer.user!.id);
  } catch {
    return jsonError(401, { error: "auth_required", message: "Please verify again to continue." });
  }

  let leagueInfo: any;
  try {
    leagueInfo = await getLeagueInfo(leagueId, accessToken);
  } catch (err: any) {
    return jsonError(502, { error: "iracing_fetch_failed", message: `Could not look up this league on iRacing: ${describeIracingError(err)}` });
  }

  const name = extractLeagueName(leagueInfo);
  if (!name) {
    return jsonError(404, { error: "league_not_found", message: "League not found." });
  }

  const { DB } = context.env;
  const now = new Date().toISOString();

  await DB.prepare(
    `INSERT INTO pace_leagues (league_id, name, last_synced_at, created_at, host_cust_id, session_name_filter)
     VALUES (?, ?, NULL, ?, ?, ?)
     ON CONFLICT(league_id) DO UPDATE SET
       name = excluded.name,
       host_cust_id = excluded.host_cust_id,
       session_name_filter = excluded.session_name_filter`
  )
    .bind(leagueId, name, now, hostCustId, sessionNameFilter)
    .run();

  return json({ ok: true, league: { leagueId, name, hostCustId, sessionNameFilter } });
}
