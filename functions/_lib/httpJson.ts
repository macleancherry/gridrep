export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export function jsonError(status: number, payload: Record<string, unknown>): Response {
  return json({ ok: false, ...payload }, status);
}
