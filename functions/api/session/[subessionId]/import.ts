import { getViewer, getValidAccessToken } from "../../../../_lib/auth";
import { iracingDataGet } from "../../../../_lib/iracing";

export async function onRequestGet(context: any) {
  const { DB } = context.env;
  const subsessionId = String(context.params.subsessionId);

  const viewer = await getViewer(context);
  if (!viewer.verified) return new Response("Not verified", { status: 401 });

  const accessToken = await getValidAccessToken(context, viewer.user!.id);

  // Fetch results
  const data: any = await iracingDataGet(
    `/data/results/get?subsession_id=${encodeURIComponent(subsessionId)}&include_licenses=false`,
    accessToken
  );

  // Map core session fields (defensive)
  const startTime = data?.start_time ?? data?.subsession_start_time ?? new Date().toISOString();
  const seriesName = data?.series_name ?? data?.series?.series_name ?? null;
  const trackName = data?.track?.track_name ?? data?.track_name ?? null;
  const split = data?.split ?? null;
  const sof = data?.sof ?? data?.strength_of_field ?? null;

  // Upsert session
  await DB.prepare(
    `INSERT INTO sessions (iracing_session_id, start_time, series_name, track_name, split, sof)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(iracing_session_id) DO UPDATE SET
       start_time=excluded.start_time,
       series_name=excluded.series_name,
       track_name=excluded.track_name,
       split=excluded.split,
       sof=excluded.sof`
  ).bind(subsessionId, startTime, seriesName, trackName, split, sof).run();

  // Participants array varies by shape; try common keys
  const participants =
    data?.session_results ??
    data?.results ??
    data?.drivers ??
    data?.rows ??
    [];

  let count = 0;

  if (Array.isArray(participants)) {
    for (const p of participants) {
      const memberId = p?.cust_id ?? p?.iracing_member_id ?? p?.member_id ?? p?.driver?.cust_id;
      if (!memberId) continue;

      const displayName = p?.display_name ?? p?.displayname ?? p?.driver_name ?? p?.name ?? p?.driver?.display_name ?? `Driver ${memberId}`;
      const finishPos = p?.finish_pos ?? p?.finish_position ?? p?.pos ?? null;
      const carName = p?.car_name ?? p?.car?.car_name ?? p?.car ?? null;

      const now = new Date().toISOString();

      // Upsert driver
      await DB.prepare(
        `INSERT INTO drivers (iracing_member_id, display_name, last_seen_at)
         VALUES (?, ?, ?)
         ON CONFLICT(iracing_member_id) DO UPDATE SET
           display_name=excluded.display_name,
           last_seen_at=excluded.last_seen_at`
      ).bind(String(memberId), displayName, now).run();

      // Upsert participant
      await DB.prepare(
        `INSERT INTO session_participants (iracing_session_id, iracing_member_id, finish_pos, car_name)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(iracing_session_id, iracing_member_id) DO UPDATE SET
           finish_pos=excluded.finish_pos,
           car_name=excluded.car_name`
      ).bind(subsessionId, String(memberId), finishPos, carName).run();

      count++;
    }
  }

  return Response.json(
    { ok: true, subsessionId, participantsImported: count },
    { headers: { "Cache-Control": "no-store" } }
  );
}
