export async function onRequestGet() {
  // OAuth will set a cookie later; for now:
  return Response.json({ verified: false });
}
