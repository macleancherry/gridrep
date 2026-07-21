import { getViewer, getValidAccessToken } from "../_lib/auth";
import { iracingDataGet } from "../_lib/iracing";
import { json, jsonError } from "../_lib/httpJson";

export async function onRequestGet(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) return jsonError(401, { error: "not_verified" });
  const accessToken = await getValidAccessToken(context, viewer.user!.id).catch((e: any) => { throw e; });
  const cars = await iracingDataGet<any>("/data/car/get", accessToken);
  const carClasses = await iracingDataGet<any>("/data/carclass/get", accessToken);
  return json({ ok: true, carsCount: Array.isArray(cars) ? cars.length : null, carsSample: Array.isArray(cars) ? cars.slice(0, 3) : cars, carClassesCount: Array.isArray(carClasses) ? carClasses.length : null, carClassesSample: Array.isArray(carClasses) ? carClasses.slice(0, 2) : carClasses });
}
