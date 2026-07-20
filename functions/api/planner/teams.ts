import { getViewer } from "../../_lib/auth";
import { json, jsonError } from "../../_lib/httpJson";

/**
 * Team CRUD (PRD: "Teams, invites, and a jobs-to-be-done navigation model"). GET lists
 * every team the viewer coordinates or is an active member of; POST creates a new team
 * and immediately seats the creator as its first coordinator - a team is never left
 * without at least one coordinator able to manage it.
 */
export async function onRequestGet(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to see your teams." });
  }

  const { DB } = context.env;
  const rows = await DB.prepare(
    `SELECT DISTINCT t.id, t.name, t.created_by as createdBy, t.created_at as createdAt,
            (t.created_by = ?) as isCreator
     FROM teams t
     LEFT JOIN team_members m ON m.team_id = t.id AND m.user_id = ? AND m.status = 'active'
     WHERE t.created_by = ? OR m.user_id IS NOT NULL
     ORDER BY t.created_at DESC`
  )
    .bind(viewer.user!.id, viewer.user!.id, viewer.user!.id)
    .all<any>();

  return json({ ok: true, teams: (rows.results ?? []).map((r: any) => ({ ...r, isCreator: Boolean(r.isCreator) })) });
}

export async function onRequestPost(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to create a team." });
  }

  const body = await context.request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return jsonError(400, { error: "invalid_name", message: "Give your team a name." });
  }

  const { DB } = context.env;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await DB.batch([
    DB.prepare(`INSERT INTO teams (id, name, created_by, created_at) VALUES (?, ?, ?, ?)`).bind(id, name, viewer.user!.id, now),
    DB.prepare(
      `INSERT INTO team_members (team_id, cust_id, user_id, role, status, invited_at, joined_at)
       VALUES (?, ?, ?, 'coordinator', 'active', ?, ?)`
    ).bind(id, viewer.user!.iracingId, viewer.user!.id, now, now),
  ]);

  return json({ ok: true, team: { id, name, createdBy: viewer.user!.id, createdAt: now } });
}
