import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { usePlanContext } from "../PlanContext";

type LineupDriver = { custId: string; driverName: string };
type ConditionProfile = { id: string; label: string };

type DriverProfile = {
  custId: string;
  driverName: string;
  paceMs: number | null;
  fuelPerLap: number | null;
};

type Stint = {
  custId: string;
  driverName: string;
  lapCount: number;
  paceMs: number;
  fuelPerLap: number;
  order: number;
  startOffsetMinutes: number;
  durationMinutes: number;
  fuelLoadLiters: number;
  pitTargetOffsetMinutes: number;
  fuelWarning: boolean;
};

type Totals = {
  totalStops: number;
  totalFuelLiters: number;
  totalDurationMinutes: number;
  seatTimeMinutesByDriver: Record<string, number>;
  stintCountByDriver: Record<string, number>;
};

type SpottingAssignment = { custId: string; driverName?: string; startOffsetMinutes: number; endOffsetMinutes: number };

type Warnings = {
  spotterGaps: { startOffsetMinutes: number; endOffsetMinutes: number }[];
  extendedStretches: { custId: string; startOffsetMinutes: number; endOffsetMinutes: number; durationMinutes: number }[];
};

function formatOffset(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.floor(minutes % 60);
  const s = Math.round((minutes % 1) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function StintsPage() {
  const { planId } = useParams<{ planId: string }>();
  const { setContext } = usePlanContext();
  const [eventId, setEventId] = useState<string | null>(null);
  const [planTeamId, setPlanTeamId] = useState<string | null>(null);
  const [lineup, setLineup] = useState<LineupDriver[]>([]);
  const [conditionProfiles, setConditionProfiles] = useState<ConditionProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [driverProfiles, setDriverProfiles] = useState<DriverProfile[]>([]);
  const [stints, setStints] = useState<Stint[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [newDriverId, setNewDriverId] = useState("");
  const [newLapCount, setNewLapCount] = useState("30");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spotting, setSpotting] = useState<SpottingAssignment[]>([]);
  const [warnings, setWarnings] = useState<Warnings | null>(null);
  const [newSpotterId, setNewSpotterId] = useState("");
  const [newSpotStart, setNewSpotStart] = useState("");
  const [newSpotEnd, setNewSpotEnd] = useState("");
  const [savingSpotting, setSavingSpotting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateNotes, setGenerateNotes] = useState<string[]>([]);

  async function loadDriverProfiles(custIds: string[], conditionProfileId: string, forEventId?: string) {
    const targetEventId = forEventId ?? eventId;
    if (!targetEventId || custIds.length === 0) return;
    const params = new URLSearchParams({ custIds: custIds.join(",") });
    if (conditionProfileId) params.set("conditionProfileId", conditionProfileId);
    const r = await fetch(`/api/planner/events/${encodeURIComponent(targetEventId)}/driver-profiles?${params.toString()}`, {
      credentials: "include",
    });
    const data = await r.json().catch(() => ({}));
    setDriverProfiles(data.profiles ?? []);
  }

  async function loadPlan(id: string) {
    const r = await fetch(`/api/planner/race-plans/${encodeURIComponent(id)}`, { credentials: "include" });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.ok) {
      setError(data.message ?? "Could not load this plan.");
      return;
    }
    setEventId(data.eventId);
    setPlanTeamId(data.teamId ?? null);
    setLineup(data.lineup ?? []);
    setStints(data.stints ?? []);
    setTotals(data.totals ?? null);
    setSpotting(data.spotting ?? []);
    setWarnings(data.warnings ?? null);
    await loadDriverProfiles((data.lineup ?? []).map((d: LineupDriver) => d.custId), selectedProfileId, data.eventId);
    return data.eventId as string;
  }

  // Pace/fuel are computed automatically in the background as soon as a driver's added on
  // the Lineup page (see lineup.ts's PUT) - poll here too so a coordinator who navigates
  // straight to Stints without waiting on Lineup still sees results land without a manual
  // refresh, and so "Generate stint plan" can unlock itself the moment everyone's ready.
  useEffect(() => {
    if (!eventId || lineup.length === 0) return;
    const allReady = lineup.every((d) => {
      const p = driverProfiles.find((x) => x.custId === d.custId);
      return p && p.paceMs !== null && p.fuelPerLap !== null;
    });
    if (allReady) return;

    const timer = setTimeout(() => {
      loadDriverProfiles(lineup.map((d) => d.custId), selectedProfileId);
    }, 2500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, lineup, selectedProfileId, driverProfiles]);

  const allProfilesReady =
    lineup.length > 0 &&
    lineup.every((d) => {
      const p = driverProfiles.find((x) => x.custId === d.custId);
      return p && p.paceMs !== null && p.fuelPerLap !== null;
    });

  // Selecting a specific condition filter needs a real compute pass the first time (each
  // condition profile gets its own stored row) - fires right from the dropdown instead of
  // a separate button, same rule as the Lineup page.
  async function onProfileFilterChange(nextProfileId: string) {
    setSelectedProfileId(nextProfileId);
    if (!eventId || lineup.length === 0) return;
    try {
      const r = await fetch(`/api/planner/events/${encodeURIComponent(eventId)}/driver-profiles`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          custIds: lineup.map((d) => d.custId),
          conditionProfileId: nextProfileId || undefined,
          teamId: planTeamId || undefined,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.ok) setDriverProfiles(data.profiles ?? []);
    } catch {
      await loadDriverProfiles(lineup.map((d) => d.custId), nextProfileId);
    }
  }

  // The plan already exists by the time this page loads - it's created at series/session
  // select time (or via Conditions' own "start a plan" fallback), never lazily here.
  async function init() {
    if (!planId) return;
    setLoading(true);
    setError(null);
    try {
      const loadedEventId = await loadPlan(planId);
      if (loadedEventId) {
        const conditionsRes = await fetch(`/api/planner/events/${encodeURIComponent(loadedEventId)}/conditions`, { credentials: "include" });
        const conditionsData = await conditionsRes.json().catch(() => ({}));
        setConditionProfiles(conditionsData.profiles ?? []);
      }
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

  function addStint() {
    const profile = driverProfiles.find((p) => p.custId === newDriverId);
    const lapCount = Number(newLapCount);
    if (!profile || !profile.paceMs || !profile.fuelPerLap || !lapCount) return;

    setStints([
      ...stints,
      {
        custId: profile.custId,
        driverName: profile.driverName,
        lapCount,
        paceMs: profile.paceMs,
        fuelPerLap: profile.fuelPerLap,
        order: stints.length,
        startOffsetMinutes: 0,
        durationMinutes: 0,
        fuelLoadLiters: 0,
        pitTargetOffsetMinutes: 0,
        fuelWarning: false,
      },
    ]);
  }

  function removeStint(index: number) {
    setStints(stints.filter((_, i) => i !== index));
  }

  function moveStint(from: number, to: number) {
    if (to < 0 || to >= stints.length || from === to) return;
    setStints((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  const [dragIndex, setDragIndex] = useState<number | null>(null);

  async function generateStints() {
    if (!planId) return;
    if (stints.length > 0 && !window.confirm("Replace the current stint list with a generated one? This won't save until you click Save stint plan.")) {
      return;
    }
    setGenerating(true);
    setError(null);
    setGenerateNotes([]);
    try {
      const r = await fetch(`/api/planner/race-plans/${encodeURIComponent(planId)}/generate-stints`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ conditionProfileId: selectedProfileId || undefined }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setError(data.message ?? "Could not generate a stint plan.");
        return;
      }
      setStints(data.stints ?? []);
      setTotals(data.totals ?? null);
      setWarnings(data.warnings ?? null);
      setGenerateNotes(data.notes ?? []);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  async function saveStints() {
    if (!planId) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/planner/race-plans/${encodeURIComponent(planId)}/stints`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          stints: stints.map((s) => ({ custId: s.custId, lapCount: s.lapCount, paceMs: s.paceMs, fuelPerLap: s.fuelPerLap })),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setError(data.message ?? "Could not save stints.");
        return;
      }
      setStints(data.stints ?? []);
      setTotals(data.totals ?? null);
      await loadPlan(planId); // refresh warnings against the newly saved stints
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function addSpotting() {
    const driver = lineup.find((d) => d.custId === newSpotterId);
    const start = Number(newSpotStart);
    const end = Number(newSpotEnd);
    if (!driver || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    setSpotting([...spotting, { custId: driver.custId, driverName: driver.driverName, startOffsetMinutes: start, endOffsetMinutes: end }]);
    setNewSpotStart("");
    setNewSpotEnd("");
  }

  function removeSpotting(index: number) {
    setSpotting(spotting.filter((_, i) => i !== index));
  }

  async function saveSpotting() {
    if (!planId) return;
    setSavingSpotting(true);
    setError(null);
    try {
      const r = await fetch(`/api/planner/race-plans/${encodeURIComponent(planId)}/duty-assignments`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          assignments: spotting.map((s) => ({ custId: s.custId, startOffsetMinutes: s.startOffsetMinutes, endOffsetMinutes: s.endOffsetMinutes })),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setError(data.message ?? "Could not save spotter assignments.");
        return;
      }
      await loadPlan(planId);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSavingSpotting(false);
    }
  }

  if (loading) return <p className="rp-section-sub">Loading…</p>;

  if (error && !eventId) {
    return (
      <div>
        <h2>Stint plan</h2>
        <p className="rp-error">{error}</p>
        <Link to="/race-planner/series" className="rp-btn" style={{ marginTop: 12 }}>
          ← Back to series
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h2>Stint plan</h2>
      {error && <p className="rp-error">{error}</p>}

      {warnings && warnings.spotterGaps.length > 0 && (
        spotting.length === 0 ? (
          // No spotting has been set up at all yet - every stint is technically a "gap",
          // but a wall of one near-identical banner per stint (13+ for a 24h race) reads
          // as broken, not informative. One combined nudge says the same thing.
          <div className="rp-warn-banner">
            ⚠ No spotter scheduled for any of the {warnings.spotterGaps.length} stint
            {warnings.spotterGaps.length === 1 ? "" : "s"} yet — add spotting below once you know who's available.
          </div>
        ) : (
          // Partial coverage already exists - each remaining gap is a specific, actionable
          // window, worth calling out individually.
          warnings.spotterGaps.map((g, i) => (
            <div className="rp-warn-banner" key={`gap-${i}`}>
              ⚠ No spotter scheduled, {formatOffset(g.startOffsetMinutes)}–{formatOffset(g.endOffsetMinutes)}.
            </div>
          ))
        )
      )}
      {warnings?.extendedStretches.map((s, i) => {
        const name = lineup.find((d) => d.custId === s.custId)?.driverName ?? s.custId;
        return (
          <div className="rp-warn-banner rp-amber" key={`stretch-${i}`}>
            ⚠ {name} driving {formatOffset(s.durationMinutes)} continuous ({formatOffset(s.startOffsetMinutes)}–
            {formatOffset(s.endOffsetMinutes)}) — beyond the fatigue threshold.
          </div>
        );
      })}

      <div className="rp-two-col">
        <div>
          <div className="rp-row" style={{ marginBottom: 16, justifyContent: "space-between", alignItems: "center" }}>
            <p className="rp-section-sub" style={{ margin: 0 }}>
              Auto-fill a starting stint order from driver pace/fuel, fatigue rules, and availability — then edit freely below.
            </p>
            <button className="rp-btn rp-primary" onClick={generateStints} disabled={generating || !allProfilesReady} title={!allProfilesReady ? "Waiting for pace/fuel data - see below" : undefined}>
              {generating ? "Generating…" : "✨ Generate stint plan"}
            </button>
          </div>
          {lineup.length > 0 && !allProfilesReady && (
            <div className="rp-card rp-card-narrow" style={{ marginBottom: 16 }}>
              <p className="rp-section-sub" style={{ margin: 0 }}>
                Still finding pace and fuel for{" "}
                {lineup.filter((d) => {
                  const p = driverProfiles.find((x) => x.custId === d.custId);
                  return !p || p.paceMs === null || p.fuelPerLap === null;
                }).length}{" "}
                of {lineup.length} driver(s) — this happens automatically in the background, no need to wait here.
                Check the <Link to={`/race-planner/lineup/${planId}`}>Lineup page</Link> if one seems stuck.
              </p>
            </div>
          )}
          {generateNotes.length > 0 && (
            <div className="rp-card rp-card-narrow" style={{ marginBottom: 16 }}>
              {generateNotes.map((n, i) => (
                <p className="rp-section-sub" key={i} style={{ margin: i === 0 ? 0 : "6px 0 0" }}>
                  {n}
                </p>
              ))}
            </div>
          )}

          <div className="rp-card" style={{ marginBottom: 16 }}>
            <div className="rp-row" style={{ marginBottom: 10 }}>
              <select className="rp-input" value={selectedProfileId} onChange={(e) => onProfileFilterChange(e.target.value)}>
                <option value="">All conditions (unfiltered)</option>
                {conditionProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <select className="rp-input" value={newDriverId} onChange={(e) => setNewDriverId(e.target.value)}>
                <option value="">Select driver…</option>
                {lineup.map((d) => {
                  const p = driverProfiles.find((x) => x.custId === d.custId);
                  const ready = Boolean(p?.paceMs && p?.fuelPerLap);
                  return (
                    <option key={d.custId} value={d.custId} disabled={!ready}>
                      {d.driverName}
                      {!ready ? " (finding pace/fuel…)" : ""}
                    </option>
                  );
                })}
              </select>
              <input
                className="rp-input"
                style={{ width: 90 }}
                type="number"
                placeholder="Laps"
                value={newLapCount}
                onChange={(e) => setNewLapCount(e.target.value)}
              />
              <button
                className="rp-btn rp-primary"
                onClick={addStint}
                disabled={!newDriverId || !driverProfiles.find((p) => p.custId === newDriverId)?.paceMs || !driverProfiles.find((p) => p.custId === newDriverId)?.fuelPerLap}
              >
                + Add stint
              </button>
            </div>
            <p className="rp-section-sub">
              Pace and fuel come from the Lineup page's automatic background search — a driver shows "finding
              pace/fuel…" until that's ready.
            </p>
          </div>

          {stints.length === 0 ? (
            <div className="rp-card rp-card-narrow">No stints yet. Add one above, or generate a starting order.</div>
          ) : (
            <div className="rp-profile-list">
              {stints.length > 1 && (
                <p className="rp-section-sub" style={{ marginBottom: 4 }}>
                  Drag the handle (⠿) to reorder, or use the arrows — order updates once you save.
                </p>
              )}
              {stints.map((s, i) => (
                <div
                  className="rp-card"
                  key={i}
                  draggable
                  onDragStart={() => setDragIndex(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIndex !== null) moveStint(dragIndex, i);
                    setDragIndex(null);
                  }}
                  onDragEnd={() => setDragIndex(null)}
                  style={{ opacity: dragIndex === i ? 0.5 : 1 }}
                >
                  <div className="rp-profile-row">
                    <div className="rp-row" style={{ alignItems: "flex-start", gap: 10 }}>
                      <span
                        className="rp-mono rp-text-faint"
                        style={{ cursor: "grab", fontSize: 18, lineHeight: "20px", userSelect: "none" }}
                        title="Drag to reorder"
                      >
                        ⠿
                      </span>
                      <div>
                        <span className="rp-badge rp-dim rp-mono" style={{ marginRight: 8 }}>
                          #{String(i + 1).padStart(2, "0")}
                        </span>
                        <span className="rp-profile-label">{s.driverName}</span>
                        {s.fuelWarning && (
                          <span className="rp-badge rp-amber" style={{ marginLeft: 8 }}>
                            Over fuel capacity
                          </span>
                        )}
                        <div className="rp-mono rp-text-faint" style={{ marginTop: 4, fontSize: 12 }}>
                          {s.lapCount} laps · start {formatOffset(s.startOffsetMinutes)} · pit target {formatOffset(s.pitTargetOffsetMinutes)} ·{" "}
                          {s.fuelLoadLiters.toFixed(1)}L
                        </div>
                      </div>
                    </div>
                    <div className="rp-row" style={{ gap: 6 }}>
                      <button className="rp-btn" onClick={() => moveStint(i, i - 1)} disabled={i === 0} title="Move up">
                        ↑
                      </button>
                      <button className="rp-btn" onClick={() => moveStint(i, i + 1)} disabled={i === stints.length - 1} title="Move down">
                        ↓
                      </button>
                      <button className="rp-btn" onClick={() => removeStint(i)}>
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="rp-row" style={{ marginTop: 16 }}>
            <button className="rp-btn rp-primary" onClick={saveStints} disabled={saving || stints.length === 0}>
              {saving ? "Saving…" : "Save stint plan"}
            </button>
          </div>
        </div>

        <div>
          <h3 style={{ fontSize: 15 }}>Spotting</h3>
          <p className="rp-section-sub" style={{ marginBottom: 12 }}>
            Freeform windows, deliberately overlapping driver handoffs — they don't need to line up with stint boundaries.
          </p>
          <div className="rp-card" style={{ marginBottom: 16 }}>
            <div className="rp-row" style={{ marginBottom: 10 }}>
              <select className="rp-input" value={newSpotterId} onChange={(e) => setNewSpotterId(e.target.value)}>
                <option value="">Select spotter…</option>
                {lineup.map((d) => (
                  <option key={d.custId} value={d.custId}>
                    {d.driverName}
                  </option>
                ))}
              </select>
              <input className="rp-input" style={{ width: 90 }} type="number" placeholder="Start (min)" value={newSpotStart} onChange={(e) => setNewSpotStart(e.target.value)} />
              <input className="rp-input" style={{ width: 90 }} type="number" placeholder="End (min)" value={newSpotEnd} onChange={(e) => setNewSpotEnd(e.target.value)} />
              <button className="rp-btn rp-primary" onClick={addSpotting} disabled={!newSpotterId}>
                + Add
              </button>
            </div>
            {spotting.length === 0 ? (
              <span className="rp-text-faint">No spotter windows yet.</span>
            ) : (
              <div className="rp-profile-list">
                {spotting.map((s, i) => (
                  <div className="rp-row" key={i} style={{ justifyContent: "space-between" }}>
                    <span className="rp-mono">
                      {s.driverName ?? s.custId}: {formatOffset(s.startOffsetMinutes)}–{formatOffset(s.endOffsetMinutes)}
                    </span>
                    <button className="rp-btn" onClick={() => removeSpotting(i)}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="rp-row" style={{ marginTop: 10 }}>
              <button className="rp-btn rp-primary" onClick={saveSpotting} disabled={savingSpotting}>
                {savingSpotting ? "Saving…" : "Save spotting"}
              </button>
            </div>
          </div>
        </div>
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
          <div className="rp-card" style={{ minWidth: 140 }}>
            <div className="rp-form-field">
              <label>Race duration</label>
            </div>
            <div className="rp-mono" style={{ fontSize: 20 }}>
              {formatOffset(totals.totalDurationMinutes)}
            </div>
          </div>
        </div>
      )}

      <div className="rp-row" style={{ marginTop: 20, justifyContent: "space-between" }}>
        <Link to={`/race-planner/lineup/${planId}`} className="rp-btn">
          ← Back to lineup
        </Link>
        <Link to={`/race-planner/availability/${planId}`} className="rp-btn">
          Availability
        </Link>
        <Link to={`/race-planner/plan/${planId}`} className="rp-btn rp-primary">
          Plan summary →
        </Link>
      </div>
    </div>
  );
}
