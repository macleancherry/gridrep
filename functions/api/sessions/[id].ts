import { getViewer } from "../../_lib/auth";
import { importSubsessionToCache } from "../iracing/session/[subsessionId]/import";

function safeLog(
  level: "log" | "warn" | "error",
  debugId: string,
  msg: string,
  extra: Record<string, unknown> = {}
) {
  // Never include tokens in logs
  console[level](JSON.stringify({ level, debugId, msg, ...extra }));
}

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

function jsonResponse(status: number, payload: Record<string, unknown>, extraHeaders?: Record<string, string>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...(extraHeaders ?? {}),
    },
  });
}

function isScopeRequiredError(err: any): boolean {
  const name = (err?.name ?? "").toString();
  const code = (err?.code ?? "").toString();
  const msg = (err?.message ?? "").toString().toLowerCase();
  const raw = (err?.raw ?? "").toString().toLowerCase();

  if (name === "IRacingScopeRequiredError") return true;
  if (code === "scope_required") return true;

  return (
    (msg.includes("iracing.auth") && msg.includes("required")) ||
    (raw.includes("iracing.auth") && raw.includes("required"))
  );
}

export async function onRequestGet(context: any) {
  const debugId = crypto.randomUUID();
  const id = context.params.id as string;
  const { DB } = context.env;

  safeLog("log", debugId, "sessions.get.start", { id });

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
    safeLog("log", debugId, "sessions.get.needs_import", {
      id,
      hasSession: Boolean(session),
      participantCount: participants.length,
      viewerVerified: viewer.verified,
    });

    if (!viewer.verified) {
      // Must not change UX rule: browsing cached sessions works; uncached requires verify.
      // Keep the existing behaviour (404 + hint header) so frontend can show verify CTA.
      return textResponse(404, "This session isn’t cached yet. Verify with iRacing to load it.", {
        "X-GridRep-Auth-Required": "1",
        "X-GridRep-Debug-Id": debugId,
      });
    }

    // Import from iRacing and then re-query
    try {
      await importSubsessionToCache(context, id);
    } catch (err: any) {
      const code = (err?.code ?? "").toString();
      const errDebugId = (err?.debugId ?? debugId).toString();

      safeLog("warn", errDebugId, "sessions.get.import_failed", {
        id,
        code: err?.code ?? null,
        name: err?.name ?? null,
        status: err?.status ?? null,
        message: err?.message ?? String(err),
      });

      // Token missing/refresh failed (ask user to verify again)
      if (code === "auth_required") {
        return jsonResponse(
          401,
          {
            error: "auth_required",
            message: "Please verify again to continue.",
            debugId: errDebugId,
          },
          { "X-GridRep-Debug-Id": errDebugId }
        );
      }

      // Subscription inactive / scope not granted
      if (code === "scope_required" || isScopeRequiredError(err)) {
        return jsonResponse(
          403,
          {
            error: "missing_required_scope",
            message:
              "Your iRacing account did not grant iracing.auth (often because the subscription is inactive). Please activate your iRacing subscription and verify again.",
            debugId: errDebugId,
          },
          { "X-GridRep-Debug-Id": errDebugId }
        );
      }

      // Not verified (shouldn't happen here because viewer.verified true, but handle defensively)
      if (code === "not_verified" || (err?.message ?? "") === "Not verified") {
        return textResponse(404, "This session isn’t cached yet. Verify with iRacing to load it.", {
          "X-GridRep-Auth-Required": "1",
          "X-GridRep-Debug-Id": errDebugId,
        });
      }

      // Generic iRacing fetch/import failure
      return jsonResponse(
        502,
        {
          error: "import_failed",
          message: "Could not import this session from iRacing. Please try again later.",
          debugId: errDebugId,
        },
        { "X-GridRep-Debug-Id": errDebugId }
      );
    }

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
      return textResponse(404, "Session not found after import.", { "X-GridRep-Debug-Id": debugId });
    }

    return Response.json(
      {
        sessionId: session2.sessionId,
        startTime: session2.startTime,
        seriesName: session2.seriesName,
        trackName: session2.trackName,
        participants: participants2,
        viewer: { verified: true },
        debugId,
      },
      { headers: { "Cache-Control": "no-store", "X-GridRep-Debug-Id": debugId } }
    );
  }

  // Normal cached response
  if (!session) {
    return textResponse(404, "Session not found.", { "X-GridRep-Debug-Id": debugId });
  }

  return Response.json(
    {
      sessionId: session.sessionId,
      startTime: session.startTime,
      seriesName: session.seriesName,
      trackName: session.trackName,
      participants,
      viewer: { verified: viewer.verified },
      debugId,
    },
    { headers: { "Cache-Control": "no-store", "X-GridRep-Debug-Id": debugId } }
  );
}
