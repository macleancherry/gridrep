import { fetchGarage61Laps, fetchGarage61Tracks, type Garage61Lap } from "./garage61";
import { matchGarage61Track } from "./plannerGarage61Fuel";
import { getValidGarage61AccessToken } from "./auth";

const MIN_CLEAN_LAPS = 3;

// Real pit stops (pit-in transit + stationary work + pit-out transit) fall well within this
// window for anything gridrep plans for. Guards against Garage61Lap.lapTime's unconfirmed
// unit (unlike fuelUsed, never previously needed by plannerGarage61Fuel.ts) silently
// producing an absurd figure instead of a flagged-unreliable null.
const PLAUSIBLE_PIT_SECONDS_MIN = 8;
const PLAUSIBLE_PIT_SECONDS_MAX = 300;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Derives pit-stop time from Garage 61's own lap data (PRD §15.1) - a sibling to
 * plannerDriverProfile.ts's computePitTimeSeconds (same in-lap-time-minus-clean-pace
 * median-delta approach), used as a fallback when the iRacing-sourced sync doesn't have
 * enough pit laps for this track yet. Garage 61's `pitlane` flag is directly reported
 * rather than inferred, so where both sources exist the iRacing-derived figure is still
 * preferred (already-shipped behavior, unchanged) purely because it's what's already
 * confirmed live - this exists to fill gaps, not replace it.
 *
 * Computes its own clean-pace baseline from these same Garage 61 laps rather than mixing
 * in the iRacing-derived pace number, since the two sources' lap clocks aren't guaranteed
 * to agree to the decimal.
 */
export function computePitTimeFromGarage61Laps(laps: Garage61Lap[]): number | null {
  const cleanLaps = laps.filter((l) => l.clean && !l.incomplete && !l.pitlane && l.lapTime > 0);
  if (cleanLaps.length < MIN_CLEAN_LAPS) return null;
  const cleanPace = median(cleanLaps.map((l) => l.lapTime));

  const pitDeltas = laps
    .filter((l) => l.pitlane && !l.incomplete && l.lapTime > 0)
    .map((l) => l.lapTime - cleanPace)
    .filter((d) => d > 0 && d < cleanPace * 3);

  if (pitDeltas.length === 0) return null;

  const seconds = Math.round(median(pitDeltas) * 10) / 10;
  if (seconds < PLAUSIBLE_PIT_SECONDS_MIN || seconds > PLAUSIBLE_PIT_SECONDS_MAX) return null;

  return seconds;
}

/**
 * Resolves Garage 61-derived pit time for one driver at one track. Direct-connection only
 * (no team-name-matching fallback like resolveGarage61Fuel has) - keeping this to the
 * confirmed-identity path avoids compounding the lapTime unit uncertainty above with
 * name-matching ambiguity too. Returns null (not an error) whenever no confident real data
 * is available.
 */
export async function resolveGarage61PitTime(
  context: any,
  DB: any,
  custId: string,
  trackName: string,
  trackConfig: string | null
): Promise<number | null> {
  const directRow = await DB.prepare(`SELECT user_id as userId FROM garage61_oauth_tokens WHERE iracing_cust_id = ?`)
    .bind(custId)
    .first<{ userId: string }>();
  if (!directRow?.userId) return null;

  const accessToken = await getValidGarage61AccessToken(context, directRow.userId).catch(() => null);
  if (!accessToken) return null;

  try {
    const tracksResp = await fetchGarage61Tracks(accessToken);
    const match = matchGarage61Track(tracksResp.items ?? [], trackName, trackConfig);
    if (match.confidence !== "exact") return null;

    const lapsResp = await fetchGarage61Laps(accessToken, {
      tracks: match.trackIds,
      drivers: ["me"],
      unclean: true,
      group: "none",
      limit: 200,
    });
    return computePitTimeFromGarage61Laps(lapsResp.items ?? []);
  } catch {
    return null;
  }
}
