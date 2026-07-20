/**
 * Team access-control helpers (PRD: "Teams, invites, and a jobs-to-be-done navigation
 * model"). A coordinator is whoever created the team, or any team_members row with
 * role='coordinator' and status='active' - the creator always gets that row inserted at
 * creation time, but this stays a genuine role check (not just a created_by check) since a
 * coordinator may eventually want to promote a co-coordinator.
 */

export async function isTeamCoordinator(DB: any, teamId: string, userId: string): Promise<boolean> {
  const row = await DB.prepare(
    `SELECT 1 FROM teams WHERE id = ? AND created_by = ?
     UNION
     SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ? AND role = 'coordinator' AND status = 'active'
     LIMIT 1`
  )
    .bind(teamId, userId, teamId, userId)
    .first();

  return Boolean(row);
}

export async function getWeekendTeamId(DB: any, weekendId: string): Promise<string | null> {
  const row = await DB.prepare(`SELECT team_id as teamId FROM race_weekends WHERE id = ?`).bind(weekendId).first<any>();
  return row?.teamId ?? null;
}

export async function isTeamMember(DB: any, teamId: string, userId: string): Promise<boolean> {
  const row = await DB.prepare(
    `SELECT 1 FROM teams WHERE id = ? AND created_by = ?
     UNION
     SELECT 1 FROM team_members WHERE team_id = ? AND user_id = ? AND status = 'active'
     LIMIT 1`
  )
    .bind(teamId, userId, teamId, userId)
    .first();

  return Boolean(row);
}
