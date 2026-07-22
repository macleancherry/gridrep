// A handful of racing-specific tokens iRacing's own raw schedule/session names use in
// all-caps or as class/series shorthand - preserved as-is rather than naively
// title-cased ("gmt" -> "Gmt" reads wrong, "GMT" is correct).
const PRESERVE_CASE = new Set([
  "gmt", "utc", "gt3", "gt4", "gte", "gtp", "lmp1", "lmp2", "lmp3", "imsa", "tcr", "dtm",
  "wec", "vln", "nec", "pmna", "vw",
]);

/**
 * Best-effort cleanup for the free-text `schedule_name`/`series_name` strings iRacing's
 * Data API returns - these are often lowercase and informally punctuated (e.g. "lemans
 * endurance - race 7 gmt"), which reads as broken/unfinished once surfaced as a heading
 * rather than buried in a search result row. Never claims to be a confirmed-correct title,
 * just a readability pass - iRacing's own capitalization for a name is unknowable from
 * this string alone.
 */
export function titleCaseRaceName(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .split(/\s+/)
    .map((word) => {
      const bare = word.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (PRESERVE_CASE.has(bare)) return word.toUpperCase();
      if (/^\d/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}
