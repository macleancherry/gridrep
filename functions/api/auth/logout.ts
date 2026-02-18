import { parseCookies, clearCookie } from "../../_lib/cookies";

export async function onRequestPost(context: any) {
  const { DB } = context.env;
  const cookies = parseCookies(context.request);
  const sid = cookies["gr_session"];

  if (sid) {
    await DB.prepare(`DELETE FROM auth_sessions WHERE id = ?`).bind(sid).run();
  }

  return new Response(null, {
    status: 204,
    headers: {
      "Set-Cookie": clearCookie("gr_session"),
    },
  });
}
