/**
 * Single chokepoint for driver identity & consent (PRD: Gridrep Driver Identity &
 * Consent, Oct 2026 - iRacing's 30 Sept 2026 third-party notice: no display name or
 * custid may be displayed/published/exposed without that member's explicit,
 * affirmative, revocable consent). Nothing outside this file and the admin roster
 * endpoint (functions/api/planner/teams/[teamId]/roster.ts) may read
 * driver_identities.
 *
 * Scope: additive to the existing shared `drivers` table (Pace, props, leaderboard,
 * feed, and gridrep's own historical cache), which stays untouched - none of those
 * are in scope for this PRD. Every planner-facing endpoint, the live-tracking proxy,
 * the Ignium integration export, and What-If resolve an opaque driver_id here and
 * call displayDriver()/displayDrivers() instead of reading drivers.display_name (or
 * any planner table's cust_id) directly.
 *
 * Internal planner tables (team_members, race_plan_lineup, etc.) keep cust_id as
 * their own key rather than being migrated to driver_id - it's never serialized in a
 * response, so the PRD's actual requirement ("no custid leaves the Worker") holds
 * without rewriting every table's primary key. See the PRD-implementation PR
 * description for the full reasoning.
 */

export type ConsentStatus = "granted" | "revoked";

export type DriverDisplay = { driverId: string; name: string | null };

export type RosterIdentity = {
  driverId: string;
  custId: string;
  displayName: string | null;
  role: string;
  status: string;
  invitedAt: string | null;
  joinedAt: string | null;
  consentStatus: ConsentStatus | null;
  grantedAt: string | null;
  revokedAt: string | null;
  evidenceRef: string | null;
};

function placeholders(n: number): string {
  return Array.from({ length: n }, () => "?").join(",");
}

/**
 * Looks up (or creates) the opaque driver_id for a set of custids in one batch -
 * replaces every ingestion path that used to upsert straight into the shared
 * `drivers` table. A display name is only recorded the first time a custid is seen;
 * later sightings don't silently overwrite it (grantConsent/the admin roster screen
 * is where a name gets corrected, not a background poll).
 */
export async function resolveDriverIds(DB: any, entries: Array<{ custId: string; displayName?: string | null }>): Promise<Map<string, string>> {
  const nameByCustId = new Map<string, string | null>();
  for (const e of entries) {
    if (!nameByCustId.has(e.custId) || e.displayName) nameByCustId.set(e.custId, e.displayName ?? nameByCustId.get(e.custId) ?? null);
  }
  const custIds = [...nameByCustId.keys()];
  const result = new Map<string, string>();
  if (custIds.length === 0) return result;

  const existing = await DB.prepare(`SELECT driver_id as driverId, cust_id as custId FROM driver_identities WHERE cust_id IN (${placeholders(custIds.length)})`)
    .bind(...custIds)
    .all<any>();
  for (const row of existing.results ?? []) result.set(row.custId, row.driverId);

  const missing = custIds.filter((id) => !result.has(id));
  if (missing.length > 0) {
    const now = new Date().toISOString();
    const statements: any[] = [];
    for (const custId of missing) {
      const driverId = crypto.randomUUID();
      result.set(custId, driverId);
      statements.push(DB.prepare(`INSERT INTO driver_registry (driver_id, first_seen_at) VALUES (?, ?)`).bind(driverId, now));
      statements.push(
        DB.prepare(`INSERT INTO driver_identities (driver_id, cust_id, display_name, updated_at) VALUES (?, ?, ?, ?)`).bind(
          driverId,
          custId,
          nameByCustId.get(custId) ?? null,
          now
        )
      );
    }
    await DB.batch(statements);
  }

  return result;
}

export async function resolveDriverId(DB: any, custId: string, displayName?: string | null): Promise<string> {
  const map = await resolveDriverIds(DB, [{ custId, displayName }]);
  return map.get(custId)!;
}

/**
 * Same as resolveDriverIds, but bridges from gridrep's older shared `drivers` cache
 * (Pace/props - read-only here, never written back to) for any custid seen before
 * this feature existed, instead of starting every driver_identities row from a blank
 * name. Used by roster-style endpoints (team members, lineup, weekend participants,
 * driver profiles) that only ever had a bare custid to work with.
 */
export async function ensureDriverIds(DB: any, custIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(custIds)];
  if (unique.length === 0) return new Map();

  const existing = await DB.prepare(`SELECT cust_id as custId FROM driver_identities WHERE cust_id IN (${placeholders(unique.length)})`)
    .bind(...unique)
    .all<any>();
  const known = new Set((existing.results ?? []).map((r: any) => r.custId));
  const unknown = unique.filter((id) => !known.has(id));

  const cachedNames = new Map<string, string | null>();
  if (unknown.length > 0) {
    const cached = await DB.prepare(
      `SELECT iracing_member_id as custId, display_name as displayName FROM drivers WHERE iracing_member_id IN (${placeholders(unknown.length)})`
    )
      .bind(...unknown)
      .all<any>();
    for (const row of cached.results ?? []) cachedNames.set(row.custId, row.displayName ?? null);
  }

  return resolveDriverIds(
    DB,
    unique.map((custId) => ({ custId, displayName: cachedNames.get(custId) ?? null }))
  );
}

export async function ensureDriverId(DB: any, custId: string): Promise<string> {
  const map = await ensureDriverIds(DB, [custId]);
  return map.get(custId)!;
}

async function getConsentMap(DB: any, driverIds: string[]): Promise<Map<string, ConsentStatus>> {
  const unique = [...new Set(driverIds)];
  const map = new Map<string, ConsentStatus>();
  if (unique.length === 0) return map;
  const rows = await DB.prepare(`SELECT driver_id as driverId, status FROM driver_consent WHERE driver_id IN (${placeholders(unique.length)})`)
    .bind(...unique)
    .all<any>();
  for (const row of rows.results ?? []) map.set(row.driverId, row.status);
  return map;
}

/**
 * The one function allowed to turn a driver_id into something shown to a client - a
 * real display name only with active ('granted') consent, otherwise null so the
 * caller falls back to its own anonymized label (car number/class/position - never a
 * name, never the driver_id's underlying custid).
 */
export async function displayDrivers(DB: any, driverIds: string[]): Promise<Map<string, DriverDisplay>> {
  const unique = [...new Set(driverIds)];
  const result = new Map<string, DriverDisplay>();
  if (unique.length === 0) return result;

  const consent = await getConsentMap(DB, unique);
  const granted = unique.filter((id) => consent.get(id) === "granted");

  const names = new Map<string, string | null>();
  if (granted.length > 0) {
    const rows = await DB.prepare(`SELECT driver_id as driverId, display_name as displayName FROM driver_identities WHERE driver_id IN (${placeholders(granted.length)})`)
      .bind(...granted)
      .all<any>();
    for (const row of rows.results ?? []) names.set(row.driverId, row.displayName ?? null);
  }

  for (const id of unique) result.set(id, { driverId: id, name: consent.get(id) === "granted" ? names.get(id) ?? null : null });
  return result;
}

export async function displayDriver(DB: any, driverId: string): Promise<DriverDisplay> {
  const map = await displayDrivers(DB, [driverId]);
  return map.get(driverId) ?? { driverId, name: null };
}

export async function grantConsent(DB: any, driverId: string, evidenceRef: string, setBy: string): Promise<void> {
  const now = new Date().toISOString();
  await DB.batch([
    DB.prepare(
      `INSERT INTO driver_consent (driver_id, status, granted_at, revoked_at, evidence_ref, set_by)
       VALUES (?, 'granted', ?, NULL, ?, ?)
       ON CONFLICT(driver_id) DO UPDATE SET status = 'granted', granted_at = excluded.granted_at, revoked_at = NULL, evidence_ref = excluded.evidence_ref, set_by = excluded.set_by`
    ).bind(driverId, now, evidenceRef, setBy),
    DB.prepare(`INSERT INTO identity_audit_log (driver_id, action, detail, set_by, created_at) VALUES (?, 'grant', ?, ?, ?)`).bind(driverId, evidenceRef, setBy, now),
  ]);
}

/** Flips consent off - displayDriver() checks driver_consent fresh on every call (no
 * cache layer exists in this app to purge, see the PRD-implementation PR
 * description), so this anonymises the driver on the very next request everywhere,
 * with nothing stale left to clear. */
export async function revokeConsent(DB: any, driverId: string, setBy: string): Promise<void> {
  const now = new Date().toISOString();
  await DB.batch([
    DB.prepare(
      `INSERT INTO driver_consent (driver_id, status, granted_at, revoked_at, evidence_ref, set_by)
       VALUES (?, 'revoked', NULL, ?, NULL, ?)
       ON CONFLICT(driver_id) DO UPDATE SET status = 'revoked', revoked_at = excluded.revoked_at, set_by = excluded.set_by`
    ).bind(driverId, now, setBy),
    DB.prepare(`INSERT INTO identity_audit_log (driver_id, action, detail, set_by, created_at) VALUES (?, 'revoke', NULL, ?, ?)`).bind(driverId, setBy, now),
  ]);
}

/**
 * Admin-only: the roster screen is the one UI allowed to show raw identities (PRD:
 * "only displayDriver and the admin roster screen read driver_identities"). Bridges
 * any team_members custid that predates this feature on the fly.
 */
export async function listTeamRosterIdentities(DB: any, teamId: string): Promise<RosterIdentity[]> {
  const members = await DB.prepare(
    `SELECT cust_id as custId, role, status, invited_at as invitedAt, joined_at as joinedAt FROM team_members WHERE team_id = ?`
  )
    .bind(teamId)
    .all<any>();
  const rows = members.results ?? [];
  if (rows.length === 0) return [];

  const driverIdByCustId = await ensureDriverIds(DB, rows.map((r: any) => r.custId));
  const driverIds = [...driverIdByCustId.values()];

  const identityRows = await DB.prepare(`SELECT driver_id as driverId, display_name as displayName FROM driver_identities WHERE driver_id IN (${placeholders(driverIds.length)})`)
    .bind(...driverIds)
    .all<any>();
  const nameByDriverId = new Map((identityRows.results ?? []).map((r: any) => [r.driverId, r.displayName]));

  const consentRows = await DB.prepare(
    `SELECT driver_id as driverId, status, granted_at as grantedAt, revoked_at as revokedAt, evidence_ref as evidenceRef
     FROM driver_consent WHERE driver_id IN (${placeholders(driverIds.length)})`
  )
    .bind(...driverIds)
    .all<any>();
  const consentByDriverId = new Map((consentRows.results ?? []).map((r: any) => [r.driverId, r]));

  return rows.map((r: any) => {
    const driverId = driverIdByCustId.get(r.custId)!;
    const consent = consentByDriverId.get(driverId);
    return {
      driverId,
      custId: r.custId,
      displayName: nameByDriverId.get(driverId) ?? null,
      role: r.role,
      status: r.status,
      invitedAt: r.invitedAt,
      joinedAt: r.joinedAt,
      consentStatus: consent?.status ?? null,
      grantedAt: consent?.grantedAt ?? null,
      revokedAt: consent?.revokedAt ?? null,
      evidenceRef: consent?.evidenceRef ?? null,
    };
  });
}

/** driver_id -> custid, admin-only (consent grant/revoke endpoints accept a custId
 * from the roster screen and need the real driver_id to write driver_consent). */
export async function driverIdForCustId(DB: any, custId: string): Promise<string | null> {
  const row = await DB.prepare(`SELECT driver_id as driverId FROM driver_identities WHERE cust_id = ?`).bind(custId).first<any>();
  return row?.driverId ?? null;
}

/**
 * Server-side-only reverse lookup: driver_id -> real custid. NEVER return the result
 * of this directly in an API response - it exists so a write endpoint that must
 * correlate with another table that's genuinely keyed by real iRacing custid
 * (driver_track_profiles, planner_iracing_laps, Garage 61 matching, iRacing lap-
 * discovery sync) can accept the opaque driverId a client actually has and resolve it
 * to the real id internally, instead of requiring the client to round-trip a custid
 * it was never given in the first place.
 */
export async function custIdForDriverId(DB: any, driverId: string): Promise<string | null> {
  const row = await DB.prepare(`SELECT cust_id as custId FROM driver_identities WHERE driver_id = ?`).bind(driverId).first<any>();
  return row?.custId ?? null;
}

/** Batched form of custIdForDriverId - same server-side-only rule applies. */
export async function custIdsForDriverIds(DB: any, driverIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(driverIds)];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const rows = await DB.prepare(`SELECT driver_id as driverId, cust_id as custId FROM driver_identities WHERE driver_id IN (${placeholders(unique.length)})`)
    .bind(...unique)
    .all<any>();
  for (const row of rows.results ?? []) map.set(row.driverId, row.custId);
  return map;
}
