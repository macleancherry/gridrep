const ALLOWED_REASONS = new Set([
  "clean_battle",
  "respectful_driving",
  "great_racecraft",
  "good_etiquette",
  "helpful_friendly",
  "other",
]);

export async function onRequestPost(context: any) {
  // OAuth will set verified identity later; for now return 401
  // so the UI triggers /api/auth/start when you click Send Props.
  return new Response("Not verified", { status: 401 });
}
