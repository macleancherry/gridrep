import { getViewer } from "../_lib/auth";

export async function onRequestGet(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) return Response.json({ verified: false }, { headers: { "Cache-Control": "no-store" } });

  const { DB } = context.env;
  const [g61, userRow] = await Promise.all([
    DB.prepare(`SELECT 1 FROM garage61_oauth_tokens WHERE user_id = ?`).bind(viewer.user!.id).first<any>(),
    DB.prepare(`SELECT onboarding_completed_at as completedAt FROM users WHERE id = ?`).bind(viewer.user!.id).first<any>(),
  ]);

  return Response.json(
    {
      verified: true,
      user: {
        id: viewer.user!.id,
        iracingId: viewer.user!.iracingId,
        name: viewer.user!.name,
      },
      garage61Connected: Boolean(g61),
      onboardingCompleted: Boolean(userRow?.completedAt),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
