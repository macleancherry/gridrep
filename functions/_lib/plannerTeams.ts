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

/**
 * Weekend-level access, covering both team weekends and a solo driver's own (team_id
 * NULL) weekend - the multi-car checklist (RaceWeekendPage.tsx) and its backend endpoints
 * (add car, participants, distribution, delete) are reachable for solo weekends too since
 * the coordinator navigation rebuild's blank-weekend creation flow allows creating one with
 * no team at all. `canView` matches isTeamMember for a team weekend, `canManage` matches
 * isTeamCoordinator - a solo weekend's own creator gets both.
 */
export async function canViewWeekend(DB: any, weekendId: string, userId: string): Promise<boolean> {
  const w = await DB.prepare(`SELECT team_id as teamId, created_by as createdBy FROM race_weekends WHERE id = ?`).bind(weekendId).first<any>();
  if (!w) return false;
  if (w.teamId) return isTeamMember(DB, w.teamId, userId);
  return w.createdBy === userId;
}

export async function canManageWeekend(DB: any, weekendId: string, userId: string): Promise<boolean> {
  const w = await DB.prepare(`SELECT team_id as teamId, created_by as createdBy FROM race_weekends WHERE id = ?`).bind(weekendId).first<any>();
  if (!w) return false;
  if (w.teamId) return isTeamCoordinator(DB, w.teamId, userId);
  return w.createdBy === userId;
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
