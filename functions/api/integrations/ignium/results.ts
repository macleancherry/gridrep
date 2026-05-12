type Context = {
  request: Request;
  env: {
    DB: D1Database;
    IGNIUM_ALLOWED_ORIGIN?: string;
    IGNIUM_INTEGRATION_TOKEN?: string;
    INTERNAL_API_TOKEN?: string;
  };
};

type IntegrationResult = {
  customerId: number | null;
  driverName: string | null;
  subsessionId: string | null;
  sessionName: string | null;
  series: string | null;
  track: string | null;
  car: string | null;
  carClass: string | null;
  qualifyingPosition: number | null;
  startPosition: number | null;
  finishPosition: number | null;
  classPosition: number | null;
  fieldSize: number | null;
  classFieldSize: number | null;
  lapsCompleted: number | null;
  bestLap: string | null;
  incidents: number | null;
  strengthOfField: number | null;
  iratingChange: number | null;
  licenseChange: string | null;
  official: boolean | null;
  completedAt: string | null;
  resultUrl: string | null;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function parseBearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const token = auth.slice(7).trim();
  return token.length > 0 ? token : null;
}

function parseOriginHeader(value: string | null): string | null {
  if (!value) return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function hasAllowedOrigin(request: Request, allowedOrigin: string | undefined): boolean {
  if (!allowedOrigin) return false;

  const origin = parseOriginHeader(request.headers.get("origin"));
  const referer = parseOriginHeader(request.headers.get("referer"));
  return origin === allowedOrigin || referer === allowedOrigin;
}

function parseCustomerIds(raw: string | null): string[] {
  if (!raw) return [];
  const ids = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^\d+$/.test(value));

  return Array.from(new Set(ids));
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toResultUrl(subsessionId: string | null): string | null {
  if (!subsessionId) return null;
  return `https://members.iracing.com/membersite/member/EventResult.do?subsessionid=${subsessionId}`;
}

export async function onRequestGet(context: Context) {
  const expectedToken = context.env.IGNIUM_INTEGRATION_TOKEN ?? context.env.INTERNAL_API_TOKEN;
  const bearer = parseBearerToken(context.request);
  if (bearer && expectedToken && bearer === expectedToken) {
    // Explicit token auth still works.
  } else if (!hasAllowedOrigin(context.request, context.env.IGNIUM_ALLOWED_ORIGIN)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }

  const url = new URL(context.request.url);
  const customerIds = parseCustomerIds(url.searchParams.get("customerIds"));
  const limitRaw = Number(url.searchParams.get("limit") ?? "20");
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.trunc(limitRaw))) : 20;

  if (customerIds.length === 0) {
    return json({ ok: false, error: "invalid_customer_ids" }, 400);
  }

  const placeholders = customerIds.map(() => "?").join(",");

  const rows = await context.env.DB.prepare(
    `SELECT
       sp.iracing_member_id as customerId,
       d.display_name as driverName,
       sp.iracing_session_id as subsessionId,
       s.series_name as sessionName,
       s.series_name as series,
       s.track_name as track,
       sp.car_name as car,
       NULL as carClass,
       NULL as qualifyingPosition,
       NULL as startPosition,
       sp.finish_pos as finishPosition,
       NULL as classPosition,
       NULL as fieldSize,
       NULL as classFieldSize,
       NULL as lapsCompleted,
       NULL as bestLap,
       NULL as incidents,
       s.sof as strengthOfField,
       NULL as iratingChange,
       NULL as licenseChange,
       NULL as official,
       s.start_time as completedAt
     FROM session_participants sp
     LEFT JOIN sessions s ON s.iracing_session_id = sp.iracing_session_id
     LEFT JOIN drivers d ON d.iracing_member_id = sp.iracing_member_id
     WHERE sp.iracing_member_id IN (${placeholders})
     ORDER BY datetime(s.start_time) DESC
     LIMIT ?`
  )
    .bind(...customerIds, limit)
    .all<Record<string, unknown>>();

  const results: IntegrationResult[] = (rows.results ?? []).map((row) => {
    const subsessionId = typeof row.subsessionId === "string" ? row.subsessionId : null;

    return {
      customerId: toNullableNumber(row.customerId),
      driverName: typeof row.driverName === "string" ? row.driverName : null,
      subsessionId,
      sessionName: typeof row.sessionName === "string" ? row.sessionName : null,
      series: typeof row.series === "string" ? row.series : null,
      track: typeof row.track === "string" ? row.track : null,
      car: typeof row.car === "string" ? row.car : null,
      carClass: null,
      qualifyingPosition: null,
      startPosition: null,
      finishPosition: toNullableNumber(row.finishPosition),
      classPosition: null,
      fieldSize: null,
      classFieldSize: null,
      lapsCompleted: null,
      bestLap: null,
      incidents: null,
      strengthOfField: toNullableNumber(row.strengthOfField),
      iratingChange: null,
      licenseChange: null,
      official: null,
      completedAt: typeof row.completedAt === "string" ? row.completedAt : null,
      resultUrl: toResultUrl(subsessionId),
    };
  });

  return json({ results });
}
