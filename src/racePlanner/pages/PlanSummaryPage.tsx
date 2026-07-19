import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { usePlanContext } from "../PlanContext";

type EventRecord = { id: string; name: string; track_name: string | null; scheduled_start_time: string | null };

type Stint = {
  custId: string;
  driverName: string;
  order: number;
  lapCount: number;
  startOffsetMinutes: number;
  pitTargetOffsetMinutes: number;
  fuelLoadLiters: number;
  fuelWarning: boolean;
};

type Spotting = { custId: string; driverName: string; startOffsetMinutes: number; endOffsetMinutes: number };

type Totals = {
  totalStops: number;
  totalFuelLiters: number;
  totalDurationMinutes: number;
  seatTimeMinutesByDriver: Record<string, number>;
  stintCountByDriver: Record<string, number>;
};

const DRIVER_COLORS = ["var(--rp-d1)", "var(--rp-d2)", "var(--rp-d3)", "var(--rp-d4)"];

function formatClock(startUtcMs: number, offsetMinutes: number): string {
  const d = new Date(startUtcMs + offsetMinutes * 60_000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}:${String(m).padStart(2, "0")}`;
}

function spotterFor(stint: Stint, spotting: Spotting[]): Spotting | null {
  return spotting.find((s) => s.startOffsetMinutes <= stint.startOffsetMinutes && s.endOffsetMinutes >= stint.pitTargetOffsetMinutes) ?? null;
}

export default function PlanSummaryPage() {
  const { planId } = useParams<{ planId: string }>();
  const { setContext } = usePlanContext();
  const [eventId, setEventId] = useState<string | null>(null);
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [stints, setStints] = useState<Stint[]>([]);
  const [spotting, setSpotting] = useState<Spotting[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [driverNames, setDriverNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function init() {
    if (!planId) return;
    setLoading(true);
    setError(null);
    try {
      const planRes = await fetch(`/api/planner/race-plans/${encodeURIComponent(planId)}`, { credentials: "include" });
      const planData = await planRes.json().catch(() => ({}));
      if (!planRes.ok || !planData.ok) {
        setError(planData.message ?? "Could not load this plan.");
        return;
      }

      setStints(planData.stints ?? []);
      setSpotting(planData.spotting ?? []);
      setTotals(planData.totals ?? null);

      const names: Record<string, string> = {};
      for (const s of planData.stints ?? []) names[s.custId] = s.driverName;
      setDriverNames(names);

      setEventId(planData.eventId ?? null);

      const eventRes = await fetch(`/api/planner/events/${encodeURIComponent(planData.eventId)}`, { credentials: "include" });
      const eventData = await eventRes.json().catch(() => ({}));
      if (eventRes.ok && eventData.ok) setEvent(eventData.event);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  useEffect(() => {
    setContext({ planId: planId ?? null, eventId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId, eventId]);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable - not worth a hard error, the URL is already visible in the address bar.
    }
  }

  if (loading) return <p className="rp-section-sub">Loading…</p>;

  if (error) {
    return (
      <div>
        <h2>Race plan</h2>
        <p className="rp-error">{error}</p>
        <Link to={`/race-planner/stints/${planId}`} className="rp-btn" style={{ marginTop: 12 }}>
          ← Back to stints
        </Link>
      </div>
    );
  }

  const uniqueDriverIds = Array.from(new Set(stints.map((s) => s.custId)));
  const colorByDriver: Record<string, string> = {};
  uniqueDriverIds.forEach((id, i) => (colorByDriver[id] = DRIVER_COLORS[i % DRIVER_COLORS.length]));

  const startUtcMs = event?.scheduled_start_time ? Date.parse(event.scheduled_start_time) : Date.now();

  return (
    <div>
      <div className="rp-row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h2>Race plan — {event?.name}</h2>
          <p className="rp-section-sub">
            {event?.track_name} {event?.scheduled_start_time ? `· ${new Date(event.scheduled_start_time).toLocaleString()}` : ""}
          </p>
        </div>
        <span className="rp-badge rp-green">{stints.length} stints planned</span>
      </div>

      <div className="rp-card" style={{ marginTop: 16, padding: 0, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--rp-border)", textAlign: "left" }}>
              {["#", "Driver", "Spotter", "Start", "End", "Laps", "Fuel", "Notes"].map((h) => (
                <th key={h} style={{ padding: "10px 14px", fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--rp-text-faint)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stints.map((s, i) => {
              const spotter = spotterFor(s, spotting);
              return (
                <tr key={i} style={{ borderBottom: "1px solid var(--rp-border-soft)" }}>
                  <td className="rp-mono" style={{ padding: "10px 14px" }}>
                    {String(i + 1).padStart(2, "0")}
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                      <span style={{ width: 9, height: 9, borderRadius: "50%", background: colorByDriver[s.custId], display: "inline-block" }} />
                      {s.driverName}
                    </span>
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    {spotter ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                        <span style={{ width: 9, height: 9, borderRadius: "50%", background: colorByDriver[spotter.custId] ?? "var(--rp-text-faint)", display: "inline-block" }} />
                        {spotter.driverName}
                      </span>
                    ) : (
                      <span style={{ color: "var(--rp-red)" }}>No spotter</span>
                    )}
                  </td>
                  <td className="rp-mono" style={{ padding: "10px 14px" }}>
                    {formatClock(startUtcMs, s.startOffsetMinutes)}
                  </td>
                  <td className="rp-mono" style={{ padding: "10px 14px" }}>
                    {formatClock(startUtcMs, s.pitTargetOffsetMinutes)}
                  </td>
                  <td className="rp-mono" style={{ padding: "10px 14px" }}>
                    {s.lapCount}
                  </td>
                  <td className="rp-mono" style={{ padding: "10px 14px" }}>
                    {s.fuelLoadLiters.toFixed(1)}L
                  </td>
                  <td className="rp-text-faint" style={{ padding: "10px 14px", fontSize: 11.5 }}>
                    {s.fuelWarning ? "Over fuel capacity" : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totals && (
        <div className="rp-row" style={{ marginTop: 20, flexWrap: "wrap", gap: 14 }}>
          <div className="rp-card" style={{ minWidth: 140 }}>
            <div className="rp-form-field">
              <label>Total stops</label>
            </div>
            <div className="rp-mono" style={{ fontSize: 20 }}>
              {totals.totalStops}
            </div>
          </div>
          <div className="rp-card" style={{ minWidth: 140 }}>
            <div className="rp-form-field">
              <label>Total fuel</label>
            </div>
            <div className="rp-mono" style={{ fontSize: 20 }}>
              {totals.totalFuelLiters.toFixed(1)}L
            </div>
          </div>
          {Object.entries(totals.seatTimeMinutesByDriver).map(([custId, minutes]) => (
            <div className="rp-card" style={{ minWidth: 140 }} key={custId}>
              <div className="rp-form-field">
                <label>Seat time · {driverNames[custId] ?? custId}</label>
              </div>
              <div className="rp-mono" style={{ fontSize: 20 }}>
                {formatHours(minutes)}h
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rp-row" style={{ marginTop: 20, justifyContent: "flex-end" }}>
        <button className="rp-btn" onClick={copyLink}>
          {copied ? "Copied!" : "Copy link"}
        </button>
        <button className="rp-btn rp-primary" onClick={() => window.print()}>
          Export / print
        </button>
      </div>

      <div className="rp-row" style={{ marginTop: 20, justifyContent: "space-between" }}>
        <Link to={`/race-planner/stints/${planId}`} className="rp-btn">
          ← Back to stints
        </Link>
        <Link to={`/race-planner/live/${planId}`} className="rp-btn rp-primary">
          Live tracking →
        </Link>
      </div>
    </div>
  );
}
