import { getViewer, getValidAccessToken } from "../../../../_lib/auth";
import { getCachedCarCatalog, resolveEligibleCars } from "../../../../_lib/plannerIracing";
import { json, jsonError } from "../../../../_lib/httpJson";

/**
 * Resolves this event's eligible_car_ids/car_class_ids (captured at select-session time
 * from car_restrictions[]/season.car_class_ids - see plannerIracing.ts) into a display-
 * ready {carId, carName, carClassId} list for the "Race car" picker on LineupPage.tsx.
 * An event with no car-restriction data (most regular series) returns an empty list - the
 * picker degrades to free-text car_name entry, same as before this feature existed.
 */
export async function onRequestGet(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Sign in to browse this event's eligible cars." });
  }

  const eventId = context.params.eventId as string;
  const { DB } = context.env;

  const event = await DB.prepare(`SELECT eligible_car_ids as eligibleCarIds, car_class_ids as carClassIds FROM iracing_events WHERE id = ?`)
    .bind(eventId)
    .first<any>();
  if (!event) {
    return jsonError(404, { error: "not_found", message: "Event not found." });
  }

  const eligibleCarIds: number[] = event.eligibleCarIds ? JSON.parse(event.eligibleCarIds) : [];
  const carClassIds: number[] = event.carClassIds ? JSON.parse(event.carClassIds) : [];

  if (eligibleCarIds.length === 0) {
    return json({ ok: true, eventId, cars: [] });
  }

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(context, viewer.user!.id);
  } catch {
    return jsonError(401, { error: "auth_required", message: "Please verify again to continue." });
  }

  let catalog;
  try {
    ({ catalog } = await getCachedCarCatalog(DB, accessToken));
  } catch {
    return jsonError(502, { error: "iracing_fetch_failed", message: "Could not load the car catalog from iRacing. Please try again." });
  }

  const cars = resolveEligibleCars(catalog, eligibleCarIds, carClassIds);
  return json({ ok: true, eventId, cars });
}
