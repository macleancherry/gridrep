import { iracingGet, type BotEnv } from "./iracingAuth.ts";

export type StandingRow = {
  cust_id?: number;
  display_name?: string;
  points?: number;
  wins?: number;
  starts?: number;
  avg_finish_position?: number;
  avg_start_position?: number;
  laps?: number;
  laps_led?: number;
  car_class_id?: number;
  car_class_name?: string;
};

export async function fetchSeasonStandings(env: BotEnv, seasonId: number, carClassId = -1): Promise<StandingRow[]> {
  const data: any = await iracingGet(
    env,
    `/data/results/season_standings?season_id=${seasonId}&car_class_id=${carClassId}&club_id=-1`
  );
  const rows: any[] = Array.isArray(data) ? data : (data?.standings ?? data?.results ?? []);
  return rows;
}

export async function fetchSeasonCarClasses(env: BotEnv, seasonId: number): Promise<{ carClassId: number; name: string }[]> {
  const data: any = await iracingGet(env, "/data/series/seasons?include_series=true");
  const list: any[] = Array.isArray(data) ? data : (data?.seasons ?? []);
  const season = list.find((s) => s.season_id === seasonId);
  const classes: any[] = season?.car_classes ?? season?.car_class_ids ?? [];
  return classes.map((c: any) =>
    typeof c === "number" ? { carClassId: c, name: `Class ${c}` } : { carClassId: c.car_class_id ?? c.id, name: c.name ?? c.car_class_name ?? `Class ${c.car_class_id ?? c.id}` }
  );
}
