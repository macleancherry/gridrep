import { getViewer, getValidAccessToken } from "../../../_lib/auth";
import { fetchLapData, buildLapDataPath, extractLapRows } from "../../../_lib/paceIracing";
import { json, jsonError } from "../../../_lib/httpJson";

/**
 * One-off diagnostic: query /data/results/lap_data for a specific
 * subsession/cust_id/simsession_number and show exactly what comes back,
 * without going through the batched multi-driver ingest. Useful for
 * isolating whether "0 laps" is real or a bug for one known-good driver.
 */
export async function onRequestGet(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required." });
  }

  const url = new URL(context.request.url);
  const subsessionId = url.searchParams.get("subsessionId");
  const custId = url.searchParams.get("custId");
  const simsessionNumber = Number(url.searchParams.get("simsessionNumber"));

  if (!subsessionId || !custId || !Number.isFinite(simsessionNumber)) {
    return jsonError(400, {
      error: "missing_params",
      message: "subsessionId, custId, and simsessionNumber (e.g. -1 or 0) query params are required.",
    });
  }

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(context, viewer.user!.id);
  } catch {
    return jsonError(401, { error: "auth_required", message: "Please verify again to continue." });
  }

  const path = buildLapDataPath(subsessionId, custId, simsessionNumber);

  try {
    const payload = await fetchLapData(subsessionId, custId, simsessionNumber, accessToken);
    const rows = await extractLapRows(payload);

    return json({
      ok: true,
      request: path,
      rowCount: rows.length,
      rowsSample: rows.slice(0, 5),
      rawPayload: payload,
    });
  } catch (err: any) {
    return jsonError(502, {
      error: "iracing_fetch_failed",
      request: path,
      message: err?.message ?? String(err),
      raw: err?.raw ?? null,
    });
  }
}
