import { fetchGarage61Laps, fetchGarage61Tracks, type Garage61Lap, type Garage61Track } from "./garage61";
import { getValidGarage61AccessToken } from "./auth";

/**
 * Merges real Garage 61 fuel-per-lap data into driver track profiles (PRD §5.2/§5.4),
 * completing the integration point driver-profiles.ts has been stubbed out for since it
 * was first built - Garage 61's real API shape (and this account-linking approach) was
 * only confirmed live once a real personal access token became available.
 *
 * Two lookup paths, in priority order:
 *  1. Direct: the target cust_id has personally connected Garage 61 (their own
 *     garage61_oauth_tokens row carries iracing_cust_id === custId, captured at connect
 *     time from GET /me/accounts). Their own laps, `drivers=me`, fully confirmed identity.
 *  2. Team-default name match: no direct connection for this cust_id, but *some* gridrep
 *     user has connected Garage 61. Confirmed live: omitting drivers/teams/extraDrivers
 *     entirely on GET /laps defaults to "driving data visible to the authenticated user",
 *     which already includes their teammates - so one connected team member's token can
 *     surface real laps for drivers who haven't personally connected. Those rows only
 *     carry a Garage 61 driver name (no cust_id), so this path matches by display name
 *     against gridrep's own `drivers` table and is honestly badged lower-confidence
 *     ("garage61_matched") rather than presented as a confirmed identity link.
 *
 * Track matching is deliberately conservative: gridrep has no car-selection UI yet (same
 * gap already documented for iRacing's own car_restrictions[] earlier in this project), so
 * laps aren't filtered by car at all - and if a track name resolves to more than one
 * Garage 61 layout variant (e.g. Spa's 7 configs) with no way to disambiguate, this skips
 * the merge entirely rather than averaging fuel numbers across different-length layouts.
 */

const MIN_CLEAN_LAPS = 3;

export type Garage61FuelResult = {
  fuelPerLap: number;
  lapsUsed: number;
  source: "garage61" | "garage61_matched";
};

export type TrackMatch = { trackIds: number[]; confidence: "exact" | "ambiguous" | "none" };

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

export function matchGarage61Track(g61Tracks: Garage61Track[], trackName: string, trackConfig?: string | null): TrackMatch {
  const target = normalize(trackName);
  const nameMatches = g61Tracks.filter((t) => normalize(t.name) === target);

  if (nameMatches.length === 0) return { trackIds: [], confidence: "none" };
  if (nameMatches.length === 1) return { trackIds: [nameMatches[0].id], confidence: "exact" };

  if (trackConfig) {
    const cfg = normalize(trackConfig);

    // Exact variant-name match first - substring matching alone is too loose here (e.g.
    // Spa's "Endurance" and "Endurance - 2010" both contain "endurance", which would
    // wrongly stay ambiguous even though "Endurance" matches one of them exactly).
    const exactConfigMatches = nameMatches.filter((t) => normalize(t.variant) === cfg);
    if (exactConfigMatches.length === 1) return { trackIds: [exactConfigMatches[0].id], confidence: "exact" };

    const looseConfigMatches = nameMatches.filter((t) => normalize(t.variant).includes(cfg) || cfg.includes(normalize(t.variant)));
    if (looseConfigMatches.length === 1) return { trackIds: [looseConfigMatches[0].id], confidence: "exact" };
  }

  // Multiple same-named layouts and no way to tell which one this event actually uses -
  // lumping different-length configs together would silently corrupt the fuel-per-lap
  // number, so don't guess.
  return { trackIds: nameMatches.map((t) => t.id), confidence: "ambiguous" };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function fuelPerLapFromLaps(laps: Garage61Lap[]): { fuelPerLap: number; lapsUsed: number } | null {
  const usable = laps.filter(
    (l) => l.clean && !l.incomplete && !l.pitlane && typeof l.fuelUsed === "number" && l.fuelUsed > 0
  );
  if (usable.length < MIN_CLEAN_LAPS) return null;

  const fuelPerLap = Math.round(median(usable.map((l) => l.fuelUsed as number)) * 1000) / 1000;
  return { fuelPerLap, lapsUsed: usable.length };
}

function displayNameMatches(g61Name: string, driverDisplayName: string): boolean {
  const a = normalize(g61Name);
  const b = normalize(driverDisplayName);
  return a === b;
}

/**
 * Resolves real Garage 61 fuel-per-lap for one driver at one track, trying the direct
 * connection first, falling back to a name match against any other connected gridrep
 * user's team-visible laps. Returns null (not an error) whenever no real data is
 * confidently available - callers should fall back to whatever manual value exists.
 */
export async function resolveGarage61Fuel(
  context: any,
  DB: any,
  custId: string,
  trackName: string,
  trackConfig: string | null
): Promise<Garage61FuelResult | null> {
  const directRow = await DB.prepare(
    `SELECT user_id as userId FROM garage61_oauth_tokens WHERE iracing_cust_id = ?`
  )
    .bind(custId)
    .first<{ userId: string }>();

  if (directRow?.userId) {
    const accessToken = await getValidGarage61AccessToken(context, directRow.userId).catch(() => null);
    if (accessToken) {
      const result = await tryFetchFuel(accessToken, trackName, trackConfig, { drivers: ["me"] });
      if (result) return { ...result, source: "garage61" };
    }
  }

  // No direct connection (or it came back empty) - fall back to any other connected
  // gridrep user's team-visible laps, matched by display name.
  const otherRows = await DB.prepare(
    `SELECT DISTINCT user_id as userId FROM garage61_oauth_tokens WHERE user_id != COALESCE(?, '')`
  )
    .bind(directRow?.userId ?? null)
    .all<{ userId: string }>();

  const driver = await DB.prepare(`SELECT display_name as displayName FROM drivers WHERE iracing_member_id = ?`)
    .bind(custId)
    .first<{ displayName: string | null }>();
  if (!driver?.displayName) return null;

  for (const row of otherRows.results ?? []) {
    const accessToken = await getValidGarage61AccessToken(context, row.userId).catch(() => null);
    if (!accessToken) continue;

    const laps = await tryFetchLaps(accessToken, trackName, trackConfig, {});
    if (!laps || laps.length === 0) continue;

    const mine = laps.filter((l) => displayNameMatches(`${l.driver.firstName} ${l.driver.lastName}`, driver.displayName as string));
    const computed = fuelPerLapFromLaps(mine);
    if (computed) return { ...computed, source: "garage61_matched" };
  }

  return null;
}

async function tryFetchLaps(
  accessToken: string,
  trackName: string,
  trackConfig: string | null,
  extra: { drivers?: Array<"me" | "following"> }
): Promise<Garage61Lap[] | null> {
  try {
    const tracksResp = await fetchGarage61Tracks(accessToken);
    const match = matchGarage61Track(tracksResp.items ?? [], trackName, trackConfig);
    if (match.confidence !== "exact") return null;

    const lapsResp = await fetchGarage61Laps(accessToken, {
      tracks: match.trackIds,
      unclean: false,
      group: "none",
      limit: 200,
      ...extra,
    });
    return lapsResp.items ?? [];
  } catch {
    return null;
  }
}

async function tryFetchFuel(
  accessToken: string,
  trackName: string,
  trackConfig: string | null,
  extra: { drivers?: Array<"me" | "following"> }
): Promise<{ fuelPerLap: number; lapsUsed: number } | null> {
  const laps = await tryFetchLaps(accessToken, trackName, trackConfig, extra);
  if (!laps) return null;
  return fuelPerLapFromLaps(laps);
}
