const ALLOWED_REASONS = new Set([
  "clean_battle",
  "respectful_driving",
  "great_racecraft",
  "good_etiquette",
  "helpful_friendly",
  "other",
]);

export async function onRequestPost(context: any) {
  const { DB } = context.env;

  const devViewer = context.env?.DEV_VIEWER_IRACING_ID ? String(context.env.DEV_VIEWER_IRACING_ID) : null;
  if (!devViewer) return new Response("Not verified", { status: 401 });

  const body = await context.request.json().catch(() => null);
  if (!body?.sessionId || !body?.toDriverId || !body?.reason) {
    return new Response("Missing fields", { status: 400 });
  }

  const sessionId = String(body.sessionId);
  const toDriverId = String(body.toDriverId);
  const reason = String(body.reason);

  if (!ALLOWED_REASONS.has(reason)) {
    return new Response("Invalid reason", { status: 400 });
  }

  // Ensure users row exists for viewer
  let user = await DB.prepare(
    `SELECT id FROM users WHERE iracing_member_id = ?`
  ).bind(devViewer).first();

  if (!user?.id) {
    const u = crypto.randomUUID();
    const dn = await DB.prepare(
      `SELECT display_name as name FROM drivers WHERE iracing_member_id = ?`
    ).bind(devViewer).first();

    await DB.prepare(
      `INSERT INTO users (id, iracing_member_id, display_name, created_at) VALUES (?, ?, ?, ?)`
    ).bind(u, devViewer, dn?.name ?? `Driver ${devViewer}`, new Date().toISOString()).run();

    user = { id: u };
  }

  // Must be a participant to send props (basic integrity)
  const part = await DB.prepare(
    `SELECT 1 FROM session_participants WHERE iracing_session_id = ? AND iracing_member_id = ?`
  ).bind(sessionId, devViewer).first();

  if (!part) return new Response("Viewer not in session", { status: 403 });

  // Must be in the session to receive props (avoid random IDs)
  const target = await DB.prepare(
    `SELECT 1 FROM session_participants WHERE iracing_session_id = ? AND iracing_member_id = ?`
  ).bind(sessionId, toDriverId).first();

  if (!target) return new Response("Target not in session", { status: 400 });

  // Prevent self-propping
  if (toDriverId === devViewer) return new Response("Cannot prop yourself", { status: 400 });

  // Insert (unique index prevents duplicates)
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  try {
    await DB.prepare(
      `INSERT INTO props (id, iracing_session_id, to_iracing_member_id, from_user_id, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(id, sessionId, toDriverId, user.id, reason, createdAt).run();
  } catch (e: any) {
    // Likely duplicate due to UNIQUE index
    return new Response("Already propped", { status: 409 });
  }

  return Response.json({ ok: true });
}
