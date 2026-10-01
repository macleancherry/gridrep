import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  resolveDriverId,
  resolveDriverIds,
  ensureDriverId,
  ensureDriverIds,
  displayDriver,
  displayDrivers,
  grantConsent,
  revokeConsent,
  listTeamRosterIdentities,
  driverIdForCustId,
} from "./driverIdentity";

/**
 * Real SQLite (node:sqlite) standing in for D1 - same SQL dialect, same ON CONFLICT
 * upsert semantics, so this exercises the actual migration 0034 schema and the actual
 * queries in driverIdentity.ts, not a hand-rolled mock of what they're assumed to do.
 */
function makeFakeD1(db: InstanceType<typeof DatabaseSync>) {
  function makeBound(sql: string, args: unknown[]): any {
    return {
      bind: (...newArgs: unknown[]) => makeBound(sql, newArgs),
      all: async () => ({ results: db.prepare(sql).all(...(args as any[])) }),
      first: async () => db.prepare(sql).get(...(args as any[])) ?? null,
      run: async () => {
        db.prepare(sql).run(...(args as any[]));
        return { success: true };
      },
    };
  }
  return {
    prepare: (sql: string) => makeBound(sql, []),
    batch: async (stmts: Array<ReturnType<typeof makeBound>>) => {
      const results = [];
      for (const s of stmts) results.push(await s.run());
      return results;
    },
  };
}

const here = dirname(fileURLToPath(import.meta.url));
const migrationSql = readFileSync(join(here, "../../migrations/0034_driver_identity_consent.sql"), "utf-8");

function freshDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(migrationSql);
  // Minimal stand-ins for the pre-existing tables driverIdentity.ts bridges from/joins
  // against - just the columns it actually reads, not the full real migrations.
  sqlite.exec(`CREATE TABLE drivers (iracing_member_id TEXT PRIMARY KEY, display_name TEXT, last_seen_at TEXT)`);
  sqlite.exec(`CREATE TABLE team_members (team_id TEXT, cust_id TEXT, role TEXT, status TEXT, invited_at TEXT, joined_at TEXT)`);
  return makeFakeD1(sqlite);
}

describe("driverIdentity", () => {
  let DB: ReturnType<typeof makeFakeD1>;

  beforeEach(() => {
    DB = freshDb();
  });

  it("resolves a new driver_id for an unseen custid and reuses it on the next call", async () => {
    const id1 = await resolveDriverId(DB, "500001", "Mac Cherry");
    const id2 = await resolveDriverId(DB, "500001");
    expect(id1).toBe(id2);
  });

  it("never shows a display name without active consent", async () => {
    const driverId = await resolveDriverId(DB, "500002", "Opponent Driver");
    const display = await displayDriver(DB, driverId);
    expect(display.name).toBeNull();
    expect(display.driverId).toBe(driverId);
  });

  it("shows the real name once consent is granted, and hides it again once revoked", async () => {
    const driverId = await resolveDriverId(DB, "500003", "Mac Cherry");

    await grantConsent(DB, driverId, "form-123", "user-1");
    expect((await displayDriver(DB, driverId)).name).toBe("Mac Cherry");

    await revokeConsent(DB, driverId, "user-1");
    expect((await displayDriver(DB, driverId)).name).toBeNull();
  });

  it("records every consent change in the append-only audit log", async () => {
    const driverId = await resolveDriverId(DB, "500004", "Mac Cherry");
    await grantConsent(DB, driverId, "form-123", "user-1");
    await revokeConsent(DB, driverId, "user-1");
    await grantConsent(DB, driverId, "form-456", "user-1");

    const rows = await DB.prepare(`SELECT action, detail FROM identity_audit_log WHERE driver_id = ? ORDER BY id ASC`).bind(driverId).all();
    expect(rows.results.map((r: any) => r.action)).toEqual(["grant", "revoke", "grant"]);
    expect(rows.results[2].detail).toBe("form-456");
  });

  it("batch-resolves driver display for a roster without per-row round trips, gating each independently", async () => {
    const consented = await resolveDriverId(DB, "600001", "Consented Driver");
    const notConsented = await resolveDriverId(DB, "600002", "Hidden Driver");
    await grantConsent(DB, consented, "form-1", "user-1");

    const display = await displayDrivers(DB, [consented, notConsented]);
    expect(display.get(consented)?.name).toBe("Consented Driver");
    expect(display.get(notConsented)?.name).toBeNull();
  });

  it("bridges a custid already cached in the legacy shared `drivers` table instead of starting blank", async () => {
    await DB.prepare(`INSERT INTO drivers (iracing_member_id, display_name, last_seen_at) VALUES (?, ?, ?)`)
      .bind("700001", "Legacy Cached Name", "2026-01-01T00:00:00Z")
      .run();

    const driverId = await ensureDriverId(DB, "700001");
    await grantConsent(DB, driverId, "form-1", "user-1");
    expect((await displayDriver(DB, driverId)).name).toBe("Legacy Cached Name");
  });

  it("lists a team's roster with raw identity + consent state (admin-only path)", async () => {
    await DB.prepare(`INSERT INTO team_members (team_id, cust_id, role, status, invited_at, joined_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind("team-1", "800001", "driver", "active", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z")
      .run();

    const roster = await listTeamRosterIdentities(DB, "team-1");
    expect(roster).toHaveLength(1);
    expect(roster[0].custId).toBe("800001");
    expect(roster[0].consentStatus).toBeNull();

    const driverId = await driverIdForCustId(DB, "800001");
    await grantConsent(DB, driverId!, "form-1", "user-1");

    const rosterAfterGrant = await listTeamRosterIdentities(DB, "team-1");
    expect(rosterAfterGrant[0].consentStatus).toBe("granted");
  });

  it("resolveDriverIds and ensureDriverIds batch without creating duplicate driver_ids for the same custid", async () => {
    const map1 = await resolveDriverIds(DB, [{ custId: "900001" }, { custId: "900002" }]);
    const map2 = await ensureDriverIds(DB, ["900001", "900002"]);
    expect(map2.get("900001")).toBe(map1.get("900001"));
    expect(map2.get("900002")).toBe(map1.get("900002"));
  });
});
