/**
 * Availability block generation (PRD §13.2/§13.5). Every block is anchored to a single
 * UTC timestamp (the race's confirmed start) and only ever converted to local time for
 * display - never stored or compared as a local-time string, to avoid DST bugs per the
 * PRD's explicit instruction (§13.1).
 */

export type ConditionWindow = {
  label: string;
  windowStartMin: number | null;
  windowEndMin: number | null;
  trackTempMin: number | null;
  trackTempMax: number | null;
  trackState: string | null;
};

export type AvailabilityBlock = {
  blockStartOffsetMinutes: number;
  blockEndOffsetMinutes: number;
  utcStart: string;
  utcEnd: string;
  localStart: string;
  localEnd: string;
  condition: { label: string; trackTempMin: number | null; trackTempMax: number | null; trackState: string | null } | null;
};

function formatLocal(ms: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(ms));
  } catch {
    // Invalid/unknown IANA zone - fall back to UTC rather than throwing and breaking the whole block list.
    return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(
      new Date(ms)
    );
  }
}

function conditionForOffset(offsetMin: number, profiles: ConditionWindow[]): ConditionWindow | null {
  for (const p of profiles) {
    if (p.windowStartMin === null || p.windowEndMin === null) continue;
    if (offsetMin >= p.windowStartMin && offsetMin < p.windowEndMin) return p;
  }
  return null;
}

export function buildAvailabilityBlocks(opts: {
  startUtcIso: string;
  durationMinutes: number;
  blockMinutes: number;
  timeZone: string;
  conditionProfiles: ConditionWindow[];
}): AvailabilityBlock[] {
  const startMs = Date.parse(opts.startUtcIso);
  const blocks: AvailabilityBlock[] = [];

  for (let offset = 0; offset < opts.durationMinutes; offset += opts.blockMinutes) {
    const endOffset = Math.min(offset + opts.blockMinutes, opts.durationMinutes);
    const blockStartMs = startMs + offset * 60_000;
    const blockEndMs = startMs + endOffset * 60_000;
    const condition = conditionForOffset(offset, opts.conditionProfiles);

    blocks.push({
      blockStartOffsetMinutes: offset,
      blockEndOffsetMinutes: endOffset,
      utcStart: new Date(blockStartMs).toISOString(),
      utcEnd: new Date(blockEndMs).toISOString(),
      localStart: formatLocal(blockStartMs, opts.timeZone),
      localEnd: formatLocal(blockEndMs, opts.timeZone),
      condition: condition
        ? { label: condition.label, trackTempMin: condition.trackTempMin, trackTempMax: condition.trackTempMax, trackState: condition.trackState }
        : null,
    });
  }

  return blocks;
}

/** Fixed five-zone organizer overview (PRD §13.3) - a standing list for this team, not a per-driver setting. */
export const ORGANIZER_OVERVIEW_ZONES = ["UTC", "Europe/London", "America/New_York", "Australia/Adelaide", "Australia/Perth"];
