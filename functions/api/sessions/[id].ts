import { getViewer } from "../../_lib/auth";
import { importSubsessionToCache } from "../iracing/session/[subsessionId]/import";

function textResponse(status: number, message: string, extraHeaders?: Record<string, string>) {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      ...(extraHeaders ?? {}),
    },
  });
}

export async function onRequestGet(context: any) {
  const id = context.params.id as string;
  const { DB } = context.env;

  const viewer = await getViewer(context);

  // Fetch session header (may exist from seed/import)
  const session = await DB.prepare(
    `SELECT iracing_session_id as sessionId,
            start_time as startTime,
            series_name as seriesName,
            track_name as trackName
     FROM sessions
     WHERE iracing_session_id = ?`
  )
    .bind(id)
    .first();

  // Fetch participants (joined to drivers)
  const participantsQuery = await DB.prepare(
    `
    SELECT
      d.iracing_member_id as id,
      d.display_name as name,
      sp.finish_pos as finishPos,
      sp.car_name as carName,
      (SELECT COUNT(*) FROM props p
        WHERE p.iracing_session_id = sp.iracing_session_id
          AND p.to_iracing_member_id = sp.iracing_member_id
      ) as props,
      CASE
        WHEN ? = 1 AND EXISTS (
          SELECT 1 FROM props p2
           WHERE p2.iracing_session_id = sp.iracing_session_id
             AND p2.to_iracing_member_id = sp.iracing_member_id
             AND p2.from_user_id = ?
        ) THEN 1
        ELSE 0
      END as alreadyPropped
    FROM session_participants sp
    JOIN drivers d ON d.iracing_member_id = sp.iracing_member_id
    WHERE sp.iracing_session_id = ?
    ORDER BY
      CASE WHEN sp.finish_pos IS NULL THEN 9999 ELSE sp.finish_pos END ASC,
      d.display_name ASC
    `
  )
    .bind(viewer.verified ? 1 : 0, viewer.verified ? viewer.user!.id : "", id)
    .all();

  const participants = (participantsQuery.results ?? []).map((r: any) => ({
    id: String(r.id),
    name: r.name,
    finishPos: typeof r.finishPos === "number" ? r.finishPos : r.finishPos == null ? undefined : Number(r.finishPos),
    carName: r.carName ?? undefined,
    props: Number(r.props ?? 0),
    alreadyPropped: !!r.alreadyPropped,
  }));

  const needsImport = !session || participants.length === 0;

  // Automatic import on "cache miss" (missing session OR empty grid)
  if (needsImport) {
    if (!viewer.verified) {
      return textResponse(
        404,
        "This session isn’t cached yet. Verify with iRacing to load it.",
        { "X-GridRep-Auth-Required": "1" }
      );
    }

    // Import from iRacing and then re-query
    await importSubsessionToCache(context, id);

    const session2 = await DB.prepare(
      `SELECT iracing_session_id as sessionId,
              start_time as startTime,
              series_name as seriesName,
              track_name as trackName
       FROM sessions
       WHERE iracing_session_id = ?`
    )
      .bind(id)
      .first();

    const participantsQuery2 = await DB.prepare(
      `
      SELECT
        d.iracing_member_id as id,
        d.display_name as name,
        sp.finish_pos as finishPos,
        sp.car_name as carName,
        (SELECT COUNT(*) FROM props p
          WHERE p.iracing_session_id = sp.iracing_session_id
            AND p.to_iracing_member_id = sp.iracing_member_id
        ) as props,
        CASE
          WHEN EXISTS (
            SELECT 1 FROM props p2
             WHERE p2.iracing_session_id = sp.iracing_session_id
               AND p2.to_iracing_member_id = sp.iracing_member_id
               AND p2.from_user_id = ?
          ) THEN 1
          ELSE 0
        END as alreadyPropped
      FROM session_participants sp
      JOIN drivers d ON d.iracing_member_id = sp.iracing_member_id
      WHERE sp.iracing_session_id = ?
      ORDER BY
        CASE WHEN sp.finish_pos IS NULL THEN 9999 ELSE sp.finish_pos END ASC,
        d.display_name ASC
      `
    )
      .bind(viewer.user!.id, id)
      .all();

    const participants2 = (participantsQuery2.results ?? []).map((r: any) => ({
      id: String(r.id),
      name: r.name,
      finishPos:
        typeof r.finishPos === "number" ? r.finishPos : r.finishPos == null ? undefined : Number(r.finishPos),
      carName: r.carName ?? undefined,
      props: Number(r.props ?? 0),
      alreadyPropped: !!r.alreadyPropped,
    }));

    if (!session2) {
      return textResponse(404, "Session not found after import.");
    }

    return Response.json(
      {
        sessionId: session2.sessionId,
        startTime: session2.startTime,
        seriesName: session2.seriesName,
        trackName: session2.trackName,
        participants: participants2,
        viewer: { verified: true },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  // Normal cached response
  if (!session) {
    return textResponse(404, "Session not found.");
  }

  return Response.json(
    {
      sessionId: session.sessionId,
      startTime: session.startTime,
      seriesName: session.seriesName,
      trackName: session.trackName,
      participants,
      viewer: { verified: viewer.verified },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
