// Scheduled/recent session data, used for the heatmap commands (/officials,
// /participation, /strengthoffield) and /popularity. iRacing's race guide
// endpoint returns upcoming and recently-run sessions with start times,
// field size, and (for completed ones) strength of field - exact field
// names are best-effort per community Data API wrappers, so every read
// here is defensive.
import { iracingGet, type BotEnv } from "./iracingAuth.ts";

export type GuideSession = {
  series_id?: number;
  series_name?: string;
  start_time?: string;
  field_size?: number;
  strength_of_field?: number;
};

export async function fetchRaceGuideSessions(env: BotEnv, seriesId?: number): Promise<GuideSession[]> {
  const data: any = await iracingGet(env, "/data/season/race_guide");
  const sessions: any[] = Array.isArray(data) ? data : (data?.sessions ?? data?.race_guide ?? []);
  return seriesId ? sessions.filter((s) => s.series_id === seriesId) : sessions;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => `${h}:00`);

/** Buckets sessions into a 7x24 (day-of-week x hour-of-day, UTC) matrix, summing `weight(session)`. */
export function buildDayHourMatrix(sessions: GuideSession[], weight: (s: GuideSession) => number): { matrix: number[][]; xLabels: string[]; yLabels: string[] } {
  const matrix: number[][] = DAY_LABELS.map(() => HOUR_LABELS.map(() => 0));
  for (const s of sessions) {
    if (!s.start_time) continue;
    const d = new Date(s.start_time);
    if (Number.isNaN(d.getTime())) continue;
    matrix[d.getUTCDay()][d.getUTCHours()] += weight(s);
  }
  return { matrix, xLabels: HOUR_LABELS, yLabels: DAY_LABELS };
}
