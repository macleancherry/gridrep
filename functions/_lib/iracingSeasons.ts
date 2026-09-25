/**
 * iRacing runs quarterly seasons that each start at 00:00 UTC on the
 * Tuesday following a build deployment - confirmed from iRacing's own
 * "Seasons & Builds" page (https://www.iracing.com/seasons/), which lists
 * every season's deployment date. The dates below are the real,
 * already-happened season starts derived from that page (deployment date
 * + the following Tuesday), not a guessed/computed formula - iRacing
 * doesn't put a season on a perfectly fixed calendar rule, so this needs
 * a new entry added each quarter once the next deployment date is public.
 */
const KNOWN_SEASON_STARTS = [
  "2024-12-17T00:00:00Z", // 2025 Season 1
  "2025-03-18T00:00:00Z", // 2025 Season 2
  "2025-06-17T00:00:00Z", // 2025 Season 3
  "2025-09-16T00:00:00Z", // 2025 Season 4
  "2025-12-16T00:00:00Z", // 2026 Season 1
  "2026-03-17T00:00:00Z", // 2026 Season 2
  "2026-06-16T00:00:00Z", // 2026 Season 3
  "2026-09-15T00:00:00Z", // 2026 Season 4
].map((d) => new Date(d));

// A season is 12-13 weeks - used only to extrapolate past the last
// confirmed date above, so a stale table degrades gracefully into a
// close estimate instead of silently reusing a season start that's a
// year (or more) out of date.
const APPROX_SEASON_LENGTH_MS = 91 * 24 * 60 * 60 * 1000;

/**
 * The start of whichever iRacing season "now" falls in. Used to scope a
 * league sync's search window to the current season only, rather than an
 * arbitrary rolling window that could straddle a season boundary (and
 * pull in - or miss - races that aren't this season's).
 */
export function currentSeasonStart(now: Date = new Date()): Date {
  let start = KNOWN_SEASON_STARTS[0];
  for (const candidate of KNOWN_SEASON_STARTS) {
    if (candidate.getTime() <= now.getTime()) start = candidate;
    else break;
  }

  const lastKnown = KNOWN_SEASON_STARTS[KNOWN_SEASON_STARTS.length - 1];
  if (start.getTime() === lastKnown.getTime() && now.getTime() > lastKnown.getTime() + APPROX_SEASON_LENGTH_MS) {
    const elapsed = now.getTime() - lastKnown.getTime();
    const periods = Math.floor(elapsed / APPROX_SEASON_LENGTH_MS);
    start = new Date(lastKnown.getTime() + periods * APPROX_SEASON_LENGTH_MS);
  }

  return start;
}
