-- Driver identity & consent (PRD: Gridrep Driver Identity & Consent, Oct 2026).
--
-- iRacing's 30 Sept 2026 third-party notice says a display name/custid may not be
-- displayed, published or exposed without that member's explicit, revocable consent.
-- This is additive and scoped to the planner (+ the Ignium integration export, the
-- live-tracking proxy, and What-If - see functions/_lib/driverIdentity.ts for the
-- enforcement chokepoint): the existing `drivers` table stays exactly as-is, since
-- it's shared infra for Pace/props/leaderboard/feed, none of which this PRD touches.
--
-- No foreign keys between these tables, matching the pattern 0029 already established
-- (migrations/0029_weekend_scoped_car_entries.sql's header) - D1/SQLite's DROP TABLE
-- still enforces "table is referenced" even with PRAGMA foreign_keys=OFF, which bit
-- this schema once already when a referenced table needed rebuilding. Integrity here
-- is enforced in application code (driverIdentity.ts), not by the database.

-- Opaque driver record every planner-facing surface keys off instead of a raw custid.
CREATE TABLE IF NOT EXISTS driver_registry (
  driver_id TEXT PRIMARY KEY,
  first_seen_at TEXT NOT NULL
);

-- Raw iRacing identity. Server-only: nothing may read this table except
-- functions/_lib/driverIdentity.ts and the admin roster screen's own endpoint.
CREATE TABLE IF NOT EXISTS driver_identities (
  driver_id TEXT PRIMARY KEY,
  cust_id TEXT NOT NULL UNIQUE,
  display_name TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_driver_identities_cust_id ON driver_identities(cust_id);

-- Consent state per driver. status flips between the two values below; granted_at/
-- revoked_at/evidence_ref/set_by record the most recent change - identity_audit_log
-- (below) keeps the full history, not just the latest state.
CREATE TABLE IF NOT EXISTS driver_consent (
  driver_id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('granted', 'revoked')),
  granted_at TEXT,
  revoked_at TEXT,
  evidence_ref TEXT,
  set_by TEXT NOT NULL
);

-- Append-only: who changed consent, when, and to what - "every consent change is
-- recorded" is its own acceptance criterion, independent of driver_consent's
-- latest-state-only row.
CREATE TABLE IF NOT EXISTS identity_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  driver_id TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  set_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_identity_audit_log_driver_id ON identity_audit_log(driver_id);
