import { json, jsonError } from "../../../_lib/httpJson";

const RETENTION_DAYS = 365; // PRD: "identities of non-consented drivers are purged after 12 months"

/**
 * Retention job (PRD: "Retention job: scheduled Worker purges non-consented
 * identities older than 12 months"). There's no Cloudflare Cron Trigger wired up for
 * this Pages project and no existing scheduler in this repo - this follows the same
 * ops-secret-header pattern functions/api/auth/logout.ts's purge already uses
 * (AUTH_PURGE_ENABLED + AUTH_PURGE_SECRET + X-GridRep-Admin), so it can be driven by
 * an external scheduled trigger (e.g. a GitHub Actions cron) hitting this endpoint,
 * the same way that one is driven manually/by ops today.
 *
 * Only driver_identities rows are deleted - driver_registry (so every other table's
 * driver_id keeps resolving) and any driver_consent/identity_audit_log history stay.
 * A driver who's currently 'granted' is never purged regardless of age; a driver
 * who's 'revoked' or was never consented at all, and who driver_registry says was
 * first seen more than 12 months ago, has their raw custid/display_name deleted -
 * their laps/stints/results stay, keyed only to the now-unlinkable driver_id, exactly
 * the "re-link later is a single join, forward only" shape the PRD's data model asks
 * for (once purged, there's no longer a custid to join back from).
 */
function isPurgeAllowed(context: any): boolean {
  const enabled = String(context.env?.AUTH_PURGE_ENABLED ?? "") === "1";
  const secret = String(context.env?.AUTH_PURGE_SECRET ?? "");
  if (!enabled || !secret) return false;

  const header = context.request.headers.get("X-GridRep-Admin") ?? "";
  return header === secret;
}

export async function onRequestPost(context: any) {
  if (!isPurgeAllowed(context)) {
    return jsonError(403, { error: "forbidden", message: "Retention purge is not enabled for this environment." });
  }

  const { DB } = context.env;
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const eligible = await DB.prepare(
    `SELECT di.driver_id as driverId
     FROM driver_identities di
     JOIN driver_registry dr ON dr.driver_id = di.driver_id
     WHERE dr.first_seen_at < ?
       AND di.driver_id NOT IN (SELECT driver_id FROM driver_consent WHERE status = 'granted')`
  )
    .bind(cutoff)
    .all<any>();

  const driverIds: string[] = (eligible.results ?? []).map((r: any) => r.driverId);
  if (driverIds.length === 0) {
    return json({ ok: true, purged: 0 });
  }

  const now = new Date().toISOString();
  const statements = driverIds.flatMap((driverId) => [
    DB.prepare(`DELETE FROM driver_identities WHERE driver_id = ?`).bind(driverId),
    DB.prepare(`INSERT INTO identity_audit_log (driver_id, action, detail, set_by, created_at) VALUES (?, 'retention_purge', ?, 'system', ?)`).bind(
      driverId,
      `Identity older than ${RETENTION_DAYS} days with no active consent.`,
      now
    ),
  ]);
  await DB.batch(statements);

  return json({ ok: true, purged: driverIds.length });
}
