import { getViewer } from "../_lib/auth";

export async function onRequestGet(context: any) {
  const viewer = await getViewer(context);
  if (!viewer.verified) return Response.json({ verified: false }, { headers: { "Cache-Control": "no-store" } });

  return Response.json(
    {
      verified: true,
      user: {
        id: viewer.user!.id,
        iracingId: viewer.user!.iracingId,
        name: viewer.user!.name,
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
