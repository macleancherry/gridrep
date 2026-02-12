export async function onRequestGet(context: any) {
  const devId = context.env?.DEV_VIEWER_IRACING_ID;
  if (devId) {
    return Response.json({ verified: true, driverId: String(devId) });
  }
  return Response.json({ verified: false });
}
