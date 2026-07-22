import { getViewer } from "../../_lib/auth";
import { isTeamCoordinator } from "../../_lib/plannerTeams";
import { json, jsonError } from "../../_lib/httpJson";

/**
 * Race Weekend CRUD (coordinator navigation rebuild, 2026-07-22). GET lists every weekend
 * the viewer can see - every team they're an active member of, plus any solo (team_id
 * NULL) weekend they created themselves - across every team, for the "Race Weekends"
 * sidebar destination. POST creates a brand-new, entirely blank weekend (no event, no cars
 * yet) - the top-down "create weekend -> add car -> pick that car's race" builder's first
 * step, replacing the old "just search a session, weekend+car auto-created together"
 * shortcut (functions/api/planner/series/[seriesId]/select-session.ts still creates a
 * weekend transparently for a call site that doesn't already have one, but nothing in the
 * new UI reaches that path directly any more).
 */
export async function onRequestGet(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to see your race weekends." });
  }

  const { DB } = context.env;

  const rows = await DB.prepare(
    `SELECT DISTINCT w.id as weekendId, w.name as weekendName, w.team_id as teamId, t.name as teamName,
            w.event_id as eventId, e.name as eventName, e.series_name as seriesName, e.track_name as trackName,
            e.scheduled_start_time as scheduledStartTime,
            (SELECT COUNT(*) FROM race_plans p WHERE p.race_weekend_id = w.id) as carCount
     FROM race_weekends w
     LEFT JOIN teams t ON t.id = w.team_id
     LEFT JOIN team_members m ON m.team_id = w.team_id AND m.user_id = ? AND m.status = 'active'
     LEFT JOIN iracing_events e ON e.id = w.event_id
     WHERE (w.team_id IS NOT NULL AND (t.created_by = ? OR m.user_id IS NOT NULL))
        OR (w.team_id IS NULL AND w.created_by = ?)
     ORDER BY e.scheduled_start_time DESC, w.created_at DESC`
  )
    .bind(viewer.user!.id, viewer.user!.id, viewer.user!.id)
    .all<any>();

  const weekends = (rows.results ?? []).map((r: any) => ({
    weekendId: r.weekendId,
    name: r.weekendName ?? r.seriesName ?? r.eventName ?? "New race weekend",
    teamId: r.teamId,
    teamName: r.teamName,
    eventId: r.eventId,
    trackName: r.trackName,
    scheduledStartTime: r.scheduledStartTime,
    carCount: r.carCount,
  }));

  return json({ ok: true, weekends });
}

export async function onRequestPost(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to create a race weekend." });
  }

  const body = await context.request.json().catch(() => null);
  const teamId = typeof body?.teamId === "string" && body.teamId ? body.teamId : null;
  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : null;

  const { DB } = context.env;

  if (teamId) {
    if (!(await isTeamCoordinator(DB, teamId, viewer.user!.id))) {
      return jsonError(403, { error: "forbidden", message: "Only that team's coordinator can create a race weekend for it." });
    }
  }
  // A teamId-less weekend is a solo driver's own - always allowed for the viewer creating it.

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await DB.prepare(`INSERT INTO race_weekends (id, team_id, event_id, name, created_by, created_at) VALUES (?, ?, NULL, ?, ?, ?)`)
    .bind(id, teamId, name, viewer.user!.id, now)
    .run();

  return json({ ok: true, weekend: { id, teamId, name, createdBy: viewer.user!.id, createdAt: now } });
}
