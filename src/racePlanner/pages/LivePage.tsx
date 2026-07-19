import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { usePlanContext } from "../PlanContext";

type Standing = {
  customerId: number;
  driverName: string;
  carNumber: string;
  position: number;
  classPosition: number;
  lap: number;
  lastLap: number | null;
  bestLap: number | null;
  gap: number | null;
  inPits: number | null;
};

type Deviation =
  | { ok: false; reason: string }
  | {
      ok: true;
      currentDriverName: string;
      currentLap: number;
      position: number;
      gapSeconds: number | null;
      inPits: boolean;
      expectedCustId: string | null;
      driverMismatch: boolean;
      beyondPlannedDistance: boolean;
      actualPaceSeconds: number | null;
      expectedPaceSeconds: number | null;
      paceDeltaPct: number | null;
      paceWarning: boolean;
      actualFuelPct: number | null;
      expectedFuelPct: number | null;
      fuelDeltaPct: number | null;
      fuelWarning: boolean;
      lapsUntilPlannedPit: number | null;
    };

type LiveResponse = {
  ok: boolean;
  linked: boolean;
  message?: string;
  subsessionId?: string;
  fetchError?: string | null;
  fieldSize?: number;
  standings?: Standing[];
  ourRows?: Standing[];
  deviation?: Deviation | null;
};

const POLL_MS = 15000;

function formatLapTime(seconds: number | null): string {
  if (seconds === null) return "—";
  const m = Math.floor(seconds / 60);
  const s = (seconds % 60).toFixed(2).padStart(5, "0");
  return `${m}:${s}`;
}

function formatPct(delta: number | null): string {
  if (delta === null) return "—";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}%`;
}

export default function LivePage() {
  const { planId } = useParams<{ planId: string }>();
  const { setContext } = usePlanContext();
  const [eventId, setEventId] = useState<string | null>(null);
  const [subsessionInput, setSubsessionInput] = useState("");
  const [linking, setLinking] = useState(false);
  const [data, setData] = useState<LiveResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function loadLive(id: string) {
    const r = await fetch(`/api/planner/race-plans/${encodeURIComponent(id)}/live`, { credentials: "include" });
    const json: LiveResponse = await r.json().catch(() => ({ ok: false, linked: false }));
    if (!r.ok || !json.ok) {
      setError((json as any).message ?? "Could not load live tracking.");
      return;
    }
    setError(null);
    setData(json);
    if (json.subsessionId) setSubsessionInput(json.subsessionId);
  }

  async function init() {
    if (!planId) return;
    setLoading(true);
    setError(null);
    try {
      const planRes = await fetch(`/api/planner/race-plans/${encodeURIComponent(planId)}`, { credentials: "include" });
      const planData = await planRes.json().catch(() => ({}));
      if (planRes.ok && planData.ok) setEventId(planData.eventId);
      await loadLive(planId);
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

  // Poll only once linked - no point hitting the endpoint every 15s for a plan with
  // nothing to watch yet.
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (planId && data?.linked) {
      pollRef.current = setInterval(() => loadLive(planId), POLL_MS);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId, data?.linked]);

  async function saveLink() {
    if (!planId) return;
    setLinking(true);
    setError(null);
    try {
      const r = await fetch(`/api/planner/race-plans/${encodeURIComponent(planId)}/live`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ subsessionId: subsessionInput }),
      });
      const resData = await r.json().catch(() => ({}));
      if (!r.ok || !resData.ok) {
        setError(resData.message ?? "Could not save the live link.");
        return;
      }
      await loadLive(planId);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLinking(false);
    }
  }

  if (loading) return <p className="rp-section-sub">Loading…</p>;

  if (error && !data) {
    return (
      <div>
        <h2>Live tracking</h2>
        <p className="rp-error">{error}</p>
        <Link to="/race-planner" className="rp-btn" style={{ marginTop: 12 }}>
          ← Back to series
        </Link>
      </div>
    );
  }

  const deviation = data?.deviation;

  return (
    <div>
      <h2>Live tracking</h2>
      <p className="rp-section-sub" style={{ marginBottom: 16 }}>
        Plan-vs-actual pace and fuel while the race is running — best-effort, since it depends on a teammate running the live collector.
      </p>
      {error && <p className="rp-error">{error}</p>}

      <div className="rp-card" style={{ marginBottom: 16, maxWidth: 520 }}>
        <div className="rp-form-field">
          <label>iRacing subsession ID</label>
        </div>
        <div className="rp-row">
          <input
            className="rp-input"
            placeholder="e.g. 123456789"
            value={subsessionInput}
            onChange={(e) => setSubsessionInput(e.target.value)}
          />
          <button className="rp-btn rp-primary" onClick={saveLink} disabled={linking}>
            {linking ? "Saving…" : data?.linked ? "Update" : "Link"}
          </button>
        </div>
        <p className="rp-section-sub" style={{ marginTop: 8 }}>
          Only known once the session is actually running — paste it in from iRacing's results page or your sim's session info once green flag drops.
        </p>
      </div>

      {!data?.linked && (
        <div className="rp-card rp-card-narrow">No live session linked yet — paste a subsession ID above once the race is underway.</div>
      )}

      {data?.linked && data.fetchError && <div className="rp-warn-banner">⚠ {data.fetchError}</div>}

      {data?.linked && !data.fetchError && deviation && !deviation.ok && (
        <div className="rp-card rp-card-narrow">
          {deviation.reason === "no_live_data_for_lineup"
            ? "No live data yet for anyone in this plan's lineup — waiting for the collector to report a lap."
            : "This plan has no saved stints yet, so deviation tracking isn't available."}
        </div>
      )}

      {data?.linked && !data.fetchError && deviation?.ok && (
        <>
          {deviation.driverMismatch && (
            <div className="rp-warn-banner rp-amber">
              ⚠ The plan expected a different driver in the car right now — {deviation.currentDriverName} is currently driving.
            </div>
          )}
          {deviation.paceWarning && (
            <div className="rp-warn-banner rp-amber">
              ⚠ Running {formatPct(deviation.paceDeltaPct !== null ? deviation.paceDeltaPct * 100 : null)} off the planned pace for this stint (
              {formatLapTime(deviation.actualPaceSeconds)} vs {formatLapTime(deviation.expectedPaceSeconds)} planned).
            </div>
          )}
          {deviation.fuelWarning && (
            <div className="rp-warn-banner">
              ⚠ Fuel reading is {Math.abs(deviation.fuelDeltaPct ?? 0).toFixed(1)} points below where the plan expects it at this point in the stint —
              consider pitting early.
            </div>
          )}
          {deviation.beyondPlannedDistance && (
            <div className="rp-warn-banner">⚠ The race has run past the plan's total planned laps — stints may need extending.</div>
          )}

          <div className="rp-row" style={{ marginTop: 4, marginBottom: 20, flexWrap: "wrap", gap: 14 }}>
            <div className="rp-card" style={{ minWidth: 140 }}>
              <div className="rp-form-field">
                <label>Position</label>
              </div>
              <div className="rp-mono" style={{ fontSize: 20 }}>
                P{deviation.position}
              </div>
            </div>
            <div className="rp-card" style={{ minWidth: 140 }}>
              <div className="rp-form-field">
                <label>Lap</label>
              </div>
              <div className="rp-mono" style={{ fontSize: 20 }}>
                {deviation.currentLap}
              </div>
            </div>
            <div className="rp-card" style={{ minWidth: 140 }}>
              <div className="rp-form-field">
                <label>Driving now</label>
              </div>
              <div className="rp-mono" style={{ fontSize: 16 }}>
                {deviation.currentDriverName} {deviation.inPits ? "(in pits)" : ""}
              </div>
            </div>
            <div className="rp-card" style={{ minWidth: 140 }}>
              <div className="rp-form-field">
                <label>Fuel vs plan</label>
              </div>
              <div className="rp-mono" style={{ fontSize: 20 }}>
                {deviation.actualFuelPct !== null ? `${deviation.actualFuelPct.toFixed(0)}%` : "—"}
                {deviation.expectedFuelPct !== null && (
                  <span className="rp-text-faint" style={{ fontSize: 12, marginLeft: 6 }}>
                    (plan: {deviation.expectedFuelPct.toFixed(0)}%)
                  </span>
                )}
              </div>
            </div>
            {deviation.lapsUntilPlannedPit !== null && (
              <div className="rp-card" style={{ minWidth: 140 }}>
                <div className="rp-form-field">
                  <label>Laps to planned pit</label>
                </div>
                <div className="rp-mono" style={{ fontSize: 20 }}>
                  {deviation.lapsUntilPlannedPit}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {data?.linked && !data.fetchError && (data.standings?.length ?? 0) > 0 && (
        <div className="rp-card">
          <div className="rp-form-field">
            <label>Standings ({data.fieldSize} cars)</label>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="rp-mono" style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left" }}>
                  <th style={{ padding: "4px 8px" }}>Pos</th>
                  <th style={{ padding: "4px 8px" }}>Driver</th>
                  <th style={{ padding: "4px 8px" }}>#</th>
                  <th style={{ padding: "4px 8px" }}>Lap</th>
                  <th style={{ padding: "4px 8px" }}>Last</th>
                  <th style={{ padding: "4px 8px" }}>Gap</th>
                </tr>
              </thead>
              <tbody>
                {(data.standings ?? []).map((s) => {
                  const isOurs = (data.ourRows ?? []).some((o) => o.customerId === s.customerId);
                  return (
                    <tr key={s.customerId} style={isOurs ? { background: "var(--rp-amber-bg, rgba(245,166,35,0.12))" } : undefined}>
                      <td style={{ padding: "4px 8px" }}>{s.position}</td>
                      <td style={{ padding: "4px 8px" }}>{s.driverName}</td>
                      <td style={{ padding: "4px 8px" }}>{s.carNumber}</td>
                      <td style={{ padding: "4px 8px" }}>{s.lap}</td>
                      <td style={{ padding: "4px 8px" }}>{formatLapTime(s.lastLap)}</td>
                      <td style={{ padding: "4px 8px" }}>{s.gap !== null ? `+${s.gap.toFixed(1)}` : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="rp-row" style={{ marginTop: 20, justifyContent: "space-between" }}>
        <Link to={`/race-planner/plan/${planId}`} className="rp-btn">
          ← Plan summary
        </Link>
      </div>
    </div>
  );
}
