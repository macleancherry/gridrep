import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * PRD acceptance criterion: "a CI test scans every API response fixture and fails on
 * any custid pattern or non-consented name." These fixtures (tests/fixtures/identity-
 * responses/*.json) document the actual response contract of every endpoint
 * functions/_lib/driverIdentity.ts gates - the planner, live tracking, the Ignium
 * integration export, and What-If. Keeping them in sync with the real endpoints is a
 * manual discipline (there's no live Worker this test can call), but the scan itself
 * is real: it fails the moment a raw-identity key name shows up in any of them, which
 * is exactly the shape of mistake this test exists to catch (a future change that adds
 * `custId`/`customerId` back into a response someone forgot was supposed to be gated).
 */

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "fixtures/identity-responses");

// roster.json is functions/api/planner/teams/[teamId]/roster.ts's own response - the
// PRD's one explicit exception ("the admin screen is the only UI that shows raw
// identities"), coordinator-only. Every other fixture represents a surface real
// drivers/opponents/Ignium's own site can reach, where no raw identity may appear.
const ADMIN_ONLY_FIXTURES = new Set(["roster.json"]);

// A narrow, explicit exception list for a field that echoes back exactly what the
// caller themselves supplied as input (their own customerIds query param), rather
// than disclosing anyone's identity - functions/api/integrations/ignium/results.ts's
// per-request diagnostics. Not a loophole: a new (file, path) pair must be added here
// deliberately, so this never silently grows to cover an actual leak.
const KNOWN_INPUT_ECHO_PATHS = new Set(["ignium-results.json.refresh.diagnostics[0].customerId"]);

const FORBIDDEN_KEY_PATTERN = /^(cust_?id|customerid|iracing_customer_id|iracing_member_id)$/i;

function walk(value: unknown, path: string, onKey: (key: string, path: string) => void): void {
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}[${i}]`, onKey));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      onKey(key, `${path}.${key}`);
      walk(v, `${path}.${key}`, onKey);
    }
  }
}

function loadFixtures(): Array<{ file: string; data: unknown }> {
  return readdirSync(fixturesDir)
    .filter((f) => f.endsWith(".json"))
    .map((file) => ({ file, data: JSON.parse(readFileSync(join(fixturesDir, file), "utf-8")) }));
}

describe("identity leak scan", () => {
  const fixtures = loadFixtures();

  it("found at least one fixture to scan", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const { file, data } of fixtures) {
    if (ADMIN_ONLY_FIXTURES.has(file)) continue;

    it(`${file}: no raw custid-shaped key anywhere in the response`, () => {
      const offenders: string[] = [];
      walk(data, file, (key, path) => {
        if (FORBIDDEN_KEY_PATTERN.test(key) && !KNOWN_INPUT_ECHO_PATHS.has(path)) offenders.push(path);
      });
      expect(offenders).toEqual([]);
    });
  }

  it("every driverId present in a non-admin fixture has a corresponding name field (possibly null, never a bare custid string)", () => {
    for (const { file, data } of fixtures) {
      if (ADMIN_ONLY_FIXTURES.has(file)) continue;
      walk(data, file, () => {});
      const asString = JSON.stringify(data);
      // A driverId is a UUID (36 chars incl. hyphens) - if a `driverId` value is a bare
      // short numeric string instead, something upstream forgot to resolve it.
      const matches = [...asString.matchAll(/"driverId":"(.*?)"/g)];
      for (const m of matches) {
        expect(m[1]).toMatch(/^[0-9a-f-]{36}$/i);
      }
    }
  });
});
