import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { usePlanContext } from "../PlanContext";

type LineupDriver = { custId: string; driverName: string };

type Block = {
  blockStartOffsetMinutes: number;
  blockEndOffsetMinutes: number;
  localStart: string;
  localEnd: string;
  condition: {
    label: string;
    trackTempMin: number | null;
    trackTempMax: number | null;
    airTempMin: number | null;
    airTempMax: number | null;
    trackState: string | null;
  } | null;
};

type OrganizerZone = { zone: string; start: string; finish: string };

type AvailabilityRow = { custId: string; driverName: string; blockStartOffsetMinutes: number; status: string };

type Status = "available" | "maybe" | "unavailable";

const detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export default function AvailabilityPage() {
  const { planId } = useParams<{ planId: string }>();
  const { setContext } = usePlanContext();
  const [tab, setTab] = useState<"organizer" | "driver">("organizer");
  const [eventId, setEventId] = useState<string | null>(null);
  const [lineup, setLineup] = useState<LineupDriver[]>([]);
  const [organizerZones, setOrganizerZones] = useState<OrganizerZone[]>([]);
  const [allAvailability, setAllAvailability] = useState<AvailabilityRow[]>([]);
  const [timeZone, setTimeZone] = useState(detectedTimeZone);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [myStatuses, setMyStatuses] = useState<Record<number, Status>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planLoadFailed, setPlanLoadFailed] = useState(false);

  async function loadBlocks(tz: string) {
    if (!planId) return;
    const r = await fetch(`/api/planner/race-plans/${encodeURIComponent(planId)}/availability/blocks?tz=${encodeURIComponent(tz)}`, {
      credentials: "include",
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.ok) {
      setBlocks(data.blocks ?? []);
      setOrganizerZones(data.organizerZones ?? []);
    }
  }

  async function loadAvailability() {
    if (!planId) return;
    const r = await fetch(`/api/planner/race-plans/${encodeURIComponent(planId)}/availability`, { credentials: "include" });
    const data = await r.json().catch(() => ({}));
    const rows: AvailabilityRow[] = data.availability ?? [];
    setAllAvailability(rows);
  }

  // The plan already exists by the time this page loads - created at series/session
  // select time, never lazily here.
  async function init() {
    if (!planId) return;
    setLoading(true);
    setError(null);
    try {
      const planRes = await fetch(`/api/planner/race-plans/${encodeURIComponent(planId)}`, { credentials: "include" });
      const planData = await planRes.json().catch(() => ({}));
      if (!planRes.ok || !planData.ok) {
        setError(planData.message ?? "Could not load this plan.");
        setPlanLoadFailed(true);
        return;
      }
      setLineup(planData.lineup ?? []);
      setEventId(planData.eventId ?? null);
    } catch {
      setError("Network error. Please try again.");
      setPlanLoadFailed(true);
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

  useEffect(() => {
    if (!planId) return;
    loadBlocks(timeZone);
    loadAvailability();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  function setBlockStatus(offset: number, status: Status) {
    setMyStatuses({ ...myStatuses, [offset]: status });
  }

  async function saveMyAvailability() {
    if (!planId) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/planner/race-plans/${encodeURIComponent(planId)}/availability`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          timezone: timeZone,
          blocks: blocks.map((b) => ({
            blockStartOffsetMinutes: b.blockStartOffsetMinutes,
            status: myStatuses[b.blockStartOffsetMinutes] ?? "available",
          })),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setError(data.message ?? "Could not save availability. Are you signed in?");
        return;
      }
      await loadAvailability();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="rp-section-sub">Loading…</p>;

  if (planLoadFailed) {
    return (
      <div>
        <h2>Availability &amp; scheduling</h2>
        <p className="rp-error">{error}</p>
        <Link to="/race-planner" className="rp-btn" style={{ marginTop: 12 }}>
          ← Back to series
        </Link>
      </div>
    );
  }

  const submittedCustIds = new Set(allAvailability.map((r) => r.custId));

  return (
    <div>
      <h2>Availability &amp; scheduling</h2>
      <p className="rp-section-sub" style={{ marginBottom: 16 }}>
        Confirm the start time, then each driver logs in to mark when they can drive.
      </p>
      {error && <p className="rp-error">{error}</p>}

      <div className="rp-row" style={{ marginBottom: 16, borderBottom: "1px solid var(--rp-border)" }}>
        <button
          className="rp-btn"
          style={tab === "organizer" ? { borderColor: "var(--rp-amber)", color: "var(--rp-amber)" } : {}}
          onClick={() => setTab("organizer")}
        >
          Organizer overview
        </button>
        <button
          className="rp-btn"
          style={tab === "driver" ? { borderColor: "var(--rp-amber)", color: "var(--rp-amber)" } : {}}
          onClick={() => setTab("driver")}
        >
          My availability
        </button>
      </div>

      {tab === "organizer" && (
        <div>
          <h3 style={{ fontSize: 15, marginBottom: 10 }}>Race window across the team's zones</h3>
          <div className="rp-form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", marginBottom: 20 }}>
            {organizerZones.map((z) => (
              <div className="rp-card" key={z.zone}>
                <div className="rp-form-field">
                  <label>{z.zone}</label>
                </div>
                <div className="rp-mono" style={{ fontSize: 12.5 }}>
                  <div>Start: {z.start}</div>
                  <div>Finish: {z.finish}</div>
                </div>
              </div>
            ))}
          </div>

          <h3 style={{ fontSize: 15, marginBottom: 10 }}>Roster status</h3>
          <div className="rp-row" style={{ flexWrap: "wrap" }}>
            {lineup.length === 0 && <span className="rp-text-faint">No lineup yet — add drivers on the Lineup page.</span>}
            {lineup.map((d) => (
              <span className="rp-badge" key={d.custId} style={submittedCustIds.has(d.custId) ? { color: "var(--rp-green)", borderColor: "var(--rp-green)" } : { color: "var(--rp-text-faint)" }}>
                {d.driverName} — {submittedCustIds.has(d.custId) ? "Submitted" : "Pending"}
              </span>
            ))}
          </div>
        </div>
      )}

      {tab === "driver" && (
        <div>
          <div className="rp-row" style={{ marginBottom: 12 }}>
            <div className="rp-form-field">
              <label>Your time zone</label>
              <input
                className="rp-input"
                style={{ minWidth: 220 }}
                value={timeZone}
                onChange={(e) => setTimeZone(e.target.value)}
                onBlur={() => loadBlocks(timeZone)}
              />
            </div>
          </div>

          <div className="rp-profile-list">
            {blocks.map((b) => {
              const status = myStatuses[b.blockStartOffsetMinutes] ?? "available";
              return (
                <div className="rp-card rp-profile-row" key={b.blockStartOffsetMinutes}>
                  <div>
                    <div className="rp-mono">{b.localStart} – {b.localEnd}</div>
                    <div className="rp-text-faint" style={{ fontSize: 11 }}>
                      R+{Math.floor(b.blockStartOffsetMinutes / 60)}:{String(b.blockStartOffsetMinutes % 60).padStart(2, "0")}
                      {b.condition ? ` · ${b.condition.label}` : ""}
                      {b.condition?.trackTempMin != null
                        ? ` · ${b.condition.trackTempMin}–${b.condition.trackTempMax}°C track`
                        : b.condition?.airTempMin != null
                          ? ` · ${b.condition.airTempMin}–${b.condition.airTempMax}°C air`
                          : ""}
                    </div>
                  </div>
                  <div className="rp-row">
                    {(["available", "maybe", "unavailable"] as Status[]).map((s) => (
                      <button
                        key={s}
                        className="rp-btn"
                        style={
                          status === s
                            ? { borderColor: s === "available" ? "var(--rp-green)" : s === "maybe" ? "var(--rp-amber)" : "var(--rp-red)", color: s === "available" ? "var(--rp-green)" : s === "maybe" ? "var(--rp-amber)" : "var(--rp-red)" }
                            : {}
                        }
                        onClick={() => setBlockStatus(b.blockStartOffsetMinutes, s)}
                      >
                        {s === "available" ? "Free" : s === "maybe" ? "Maybe" : "No"}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="rp-row" style={{ marginTop: 16, justifyContent: "flex-end" }}>
            <button className="rp-btn rp-primary" onClick={saveMyAvailability} disabled={saving}>
              {saving ? "Saving…" : "Save availability"}
            </button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        <Link to={`/race-planner/stints/${planId}`} className="rp-btn">
          ← Back to stints
        </Link>
      </div>
    </div>
  );
}
