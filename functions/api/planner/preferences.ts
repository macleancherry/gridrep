import { getViewer } from "../../_lib/auth";
import { json, jsonError } from "../../_lib/httpJson";

const CATEGORIES = ["racing_mode", "discipline", "format"] as const;
type Category = (typeof CATEGORIES)[number];

const VALID_VALUES: Record<Category, string[]> = {
  racing_mode: ["solo", "team"],
  discipline: ["road", "oval", "dirt_road", "dirt_oval"],
  format: ["sprint", "endurance", "special"],
};

/**
 * Onboarding preference wizard (racing mode / discipline / format) - each category is
 * independently multi-select, stored as category/value rows rather than fixed columns.
 * GET returns the viewer's saved answers plus whether they've completed the wizard at
 * all (distinct from "selected nothing" - a driver can legitimately clear every option
 * in a category and still be done). PUT replaces all three categories wholesale, same
 * "client sends the full set" pattern as lineup/stints/pit-rules elsewhere in this app.
 */
export async function onRequestGet(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required." });
  }

  const { DB } = context.env;
  const [prefsRows, userRow] = await Promise.all([
    DB.prepare(`SELECT category, value FROM user_preferences WHERE user_id = ?`).bind(viewer.user!.id).all<any>(),
    DB.prepare(`SELECT onboarding_completed_at as completedAt FROM users WHERE id = ?`).bind(viewer.user!.id).first<any>(),
  ]);

  const preferences: Record<Category, string[]> = { racing_mode: [], discipline: [], format: [] };
  for (const row of prefsRows.results ?? []) {
    if (CATEGORIES.includes(row.category)) preferences[row.category as Category].push(row.value);
  }

  return json({ ok: true, preferences, onboardingCompleted: Boolean(userRow?.completedAt) });
}

export async function onRequestPut(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) {
    return jsonError(401, { error: "not_verified", message: "Verification required." });
  }

  const body = await context.request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return jsonError(400, { error: "invalid_body", message: "Expected a JSON object." });
  }

  const rows: { category: Category; value: string }[] = [];
  for (const category of CATEGORIES) {
    const values = Array.isArray(body[category]) ? body[category] : [];
    for (const v of values) {
      if (typeof v === "string" && VALID_VALUES[category].includes(v)) rows.push({ category, value: v });
    }
  }

  const { DB } = context.env;
  const userId = viewer.user!.id;
  const now = new Date().toISOString();

  const statements = [
    DB.prepare(`DELETE FROM user_preferences WHERE user_id = ?`).bind(userId),
    ...rows.map((r) =>
      DB.prepare(`INSERT INTO user_preferences (user_id, category, value) VALUES (?, ?, ?)`).bind(userId, r.category, r.value)
    ),
    DB.prepare(`UPDATE users SET onboarding_completed_at = COALESCE(onboarding_completed_at, ?) WHERE id = ?`).bind(now, userId),
  ];

  await DB.batch(statements);

  return json({ ok: true });
}
