export async function onRequestGet(context: any) {
  const url = new URL(context.request.url);
  const q = (url.searchParams.get("q") || "").trim();

  // Stub until iRacing API is wired: return empty results
  return Response.json(
    { query: q, results: [] },
    { headers: { "Cache-Control": "public, max-age=60" } }
  );
}
