import { refreshRecentRacesForMember } from "../../../_lib/recent";

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

  const explicitOrigin = parseOriginHeader(request.headers.get("x-ignium-origin"));
  const origin = parseOriginHeader(request.headers.get("origin"));
  const referer = parseOriginHeader(request.headers.get("referer"));
  return explicitOrigin === allowedOrigin || origin === allowedOrigin || referer === allowedOrigin;
}

function parseCustomerIds(raw: string | null): string[] {
  if (!raw) return [];
  const ids = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^\d+$/.test(value));

  return Array.from(new Set(ids));
}

function clampInt(value: number | null, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function parseIntParam(url: URL, key: string): number | null {
  const raw = url.searchParams.get(key);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function parseBoolParam(url: URL, key: string, fallback: boolean): boolean {
  const raw = url.searchParams.get(key);
  if (!raw) return fallback;
  const value = raw.trim().toLowerCase();
  if (value === "1" || value === "true" || value === "yes") return true;
  if (value === "0" || value === "false" || value === "no") return false;
  return fallback;
}

function parseIsoParam(url: URL, key: string): string | undefined {
  const raw = url.searchParams.get(key);
  if (!raw) return undefined;
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return undefined;
  return date.toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const limit = clampInt(parseIntParam(url, "limit"), 1, 250, 20);
  const refreshMode = url.searchParams.get("refreshMode") === "window" ? "window" : "recent";
  const windowStart = parseIsoParam(url, "windowStart");
  const windowEnd = parseIsoParam(url, "windowEnd");
  const includeHosted = parseBoolParam(url, "includeHosted", true);
  const officialOnly = parseBoolParam(url, "officialOnly", true);
  const importConcurrency = clampInt(parseIntParam(url, "importConcurrency"), 1, 5, 1);
  const importDelayMs = clampInt(parseIntParam(url, "importDelayMs"), 0, 5000, 750);
  const queryDelayMs = clampInt(parseIntParam(url, "queryDelayMs"), 0, 5000, 350);
  const chunkDelayMs = clampInt(parseIntParam(url, "chunkDelayMs"), 0, 5000, 350);
  const maxChunkFiles = clampInt(parseIntParam(url, "maxChunkFiles"), 1, 200, 50);
  const driverDelayMs = clampInt(parseIntParam(url, "driverDelayMs"), 0, 10000, 500);

  if (customerIds.length === 0) {
    return json({ ok: false, error: "invalid_customer_ids" }, 400);
  }

  if (refreshMode === "window" && (!windowStart || !windowEnd)) {
    return json({ ok: false, error: "invalid_window", message: "windowStart and windowEnd are required for refreshMode=window" }, 400);
  }

  const refreshDiagnostics: Array<Record<string, unknown>> = [];

  for (let i = 0; i < customerIds.length; i += 1) {
    const customerId = customerIds[i];
    const refresh = await refreshRecentRacesForMember(context, customerId, limit, {
      mode: refreshMode,
      windowStart,
      windowEnd,
      includeHosted,
      officialOnly,
      importConcurrency,
      importDelayMs,
      queryDelayMs,
      chunkDelayMs,
      maxChunkFiles,
    });

    refreshDiagnostics.push({ customerId, ...refresh });

    if (i < customerIds.length - 1 && driverDelayMs > 0) {
      await sleep(driverDelayMs);
    }
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
      sp.car_class as carClass,
      sp.qualifying_pos as qualifyingPosition,
      sp.start_pos as startPosition,
       sp.finish_pos as finishPosition,
      sp.class_pos as classPosition,
      sp.field_size as fieldSize,
      sp.class_field_size as classFieldSize,
      sp.laps_completed as lapsCompleted,
      sp.best_lap as bestLap,
      sp.incidents as incidents,
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
      carClass: typeof row.carClass === "string" ? row.carClass : null,
      qualifyingPosition: toNullableNumber(row.qualifyingPosition),
      startPosition: toNullableNumber(row.startPosition),
      finishPosition: toNullableNumber(row.finishPosition),
      classPosition: toNullableNumber(row.classPosition),
      fieldSize: toNullableNumber(row.fieldSize),
      classFieldSize: toNullableNumber(row.classFieldSize),
      lapsCompleted: toNullableNumber(row.lapsCompleted),
      bestLap: typeof row.bestLap === "string" ? row.bestLap : null,
      incidents: toNullableNumber(row.incidents),
      strengthOfField: toNullableNumber(row.strengthOfField),
      iratingChange: null,
      licenseChange: null,
      official: null,
      completedAt: typeof row.completedAt === "string" ? row.completedAt : null,
      resultUrl: toResultUrl(subsessionId),
    };
  });

  return json({
    results,
    refresh: {
      mode: refreshMode,
      limit,
      windowStart,
      windowEnd,
      includeHosted,
      officialOnly,
      importConcurrency,
      importDelayMs,
      queryDelayMs,
      chunkDelayMs,
      maxChunkFiles,
      driverDelayMs,
      diagnostics: refreshDiagnostics,
    },
  });
}
