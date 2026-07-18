import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { usePlanContext } from "../PlanContext";

type ConditionProfile = { id: string; label: string };

type DriverProfile = {
  custId: string;
  driverName: string;
  ok: boolean;
  reason?: string;
  paceMs: number | null;
  lapsUsed: number;
  sampleSize: number;
  widenedBand: boolean;
  fuelPerLap: number | null;
  fuelSource: string | null;
  pitTimeSeconds: number | null;
  pitTimeSource: string | null;
};

type DriverSearchResult = { id: string; name: string };

function formatPace(ms: number | null): string {
  if (ms === null) return "—";
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds % 60).toFixed(3).padStart(6, "0");
  return `${minutes}:${seconds}`;
}

export default function LineupPage() {
  const { planId } = useParams<{ planId: string }>();
  const { setContext } = usePlanContext();
  const [eventId, setEventId] = useState<string | null>(null);
  const [teamSize, setTeamSize] = useState<{ min: number | null; max: number | null }>({ min: null, max: null });
  const [lineup, setLineup] = useState<{ custId: string; name: string }[]>([]);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<DriverSearchResult[]>([]);
  const [conditionProfiles, setConditionProfiles] = useState<ConditionProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [profiles, setProfiles] = useState<DriverProfile[]>([]);
  const [computing, setComputing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fuelDrafts, setFuelDrafts] = useState<Record<string, string>>({});

  // Load the plan (for its event_id + already-saved lineup) once on mount.
  useEffect(() => {
    if (!planId) return;
    setLoading(true);
    fetch(`/api/planner/race-plans/${encodeURIComponent(planId)}`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) {
          setError(data.message ?? "Could not load this plan.");
          return;
        }
        setEventId(data.eventId);
        setLineup((data.lineup ?? []).map((d: any) => ({ custId: d.custId, name: d.driverName ?? `Driver ${d.custId}` })));
      })
      .catch(() => setError("Network error. Please try again."))
      .finally(() => setLoading(false));
  }, [planId]);

  useEffect(() => {
    setContext({ planId: planId ?? null, eventId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId, eventId]);

  useEffect(() => {
    if (!eventId) return;
    fetch(`/api/planner/events/${encodeURIComponent(eventId)}/conditions`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setConditionProfiles(data.profiles ?? []))
      .catch(() => setConditionProfiles([]));

    fetch(`/api/planner/events/${encodeURIComponent(eventId)}`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.event) {
          setTeamSize({ min: data.event.min_team_drivers ?? null, max: data.event.max_team_drivers ?? null });
        }
      })
      .catch(() => {});
  }, [eventId]);

  async function saveLineup(next: { custId: string; name: string }[]) {
    if (!planId) return;
    setSaving(true);
    try {
      await fetch(`/api/planner/race-plans/${encodeURIComponent(planId)}/lineup`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ custIds: next.map((d) => d.custId) }),
      });
    } catch {
      setError("Could not save the lineup - your changes may not persist.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    const handle = setTimeout(() => {
      fetch(`/api/drivers/search?q=${encodeURIComponent(query.trim())}`)
        .then((r) => r.json())
        .then((data) => setSearchResults(data.results ?? []))
        .catch(() => setSearchResults([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  function addDriver(custId: string, name: string) {
    if (lineup.some((d) => d.custId === custId)) return;
    const next = [...lineup, { custId, name }];
    setLineup(next);
    setQuery("");
    setSearchResults([]);
    saveLineup(next);
  }

  function removeDriver(custId: string) {
    const next = lineup.filter((d) => d.custId !== custId);
    setLineup(next);
    saveLineup(next);
  }

  async function computeProfiles() {
    if (!eventId || lineup.length === 0) return;
    setComputing(true);
    setError(null);
    try {
      const fuelOverrides: Record<string, number> = {};
      for (const [custId, raw] of Object.entries(fuelDrafts)) {
        const n = Number(raw);
        if (raw.trim() !== "" && Number.isFinite(n)) fuelOverrides[custId] = n;
      }

      const r = await fetch(`/api/planner/events/${encodeURIComponent(eventId)}/driver-profiles`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          custIds: lineup.map((d) => d.custId),
          conditionProfileId: selectedProfileId || undefined,
          fuelOverrides,
        }),
      });
      const data = await r.json().catch(() => ({}));

      if (!r.ok || !data.ok) {
        setError(data.message ?? "Could not compute driver profiles.");
        return;
      }

      setProfiles(data.profiles ?? []);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setComputing(false);
    }
  }

  if (loading) return <p className="rp-section-sub">Loading…</p>;

  return (
    <div>
      <h2>Driver lineup {saving && <span className="rp-text-faint" style={{ fontSize: 12, fontWeight: 400, textTransform: "none" }}>(saving…)</span>}</h2>
      <p className="rp-section-sub" style={{ marginBottom: 16 }}>
        Pace and fuel profiles, filtered to laps run in conditions matching the selected segment.
      </p>

      {error && <p className="rp-error">{error}</p>}

      <div className="rp-card" style={{ marginBottom: 16, position: "relative" }}>
        <div className="rp-row" style={{ marginBottom: 10 }}>
          <input
            className="rp-input"
            placeholder="Search by driver name or cust_id"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ minWidth: 260 }}
          />
        </div>
        {searchResults.length > 0 && (
          <div className="rp-profile-list" style={{ marginBottom: 10 }}>
            {searchResults.map((d) => (
              <div className="rp-row" key={d.id} style={{ justifyContent: "space-between" }}>
                <span>
                  {d.name} <span className="rp-text-faint rp-mono">#{d.id}</span>
                </span>
                <button className="rp-btn" onClick={() => addDriver(d.id, d.name)}>
                  + Add
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="rp-row" style={{ flexWrap: "wrap" }}>
          {lineup.length === 0 && <span className="rp-text-faint">No drivers added yet.</span>}
          {lineup.map((d) => (
            <span className="rp-badge rp-dim" key={d.custId}>
              {d.name}
              <button
                onClick={() => removeDriver(d.custId)}
                style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", marginLeft: 4, padding: 0 }}
                aria-label={`Remove ${d.name}`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </div>

      {(teamSize.min !== null || teamSize.max !== null) &&
        (teamSize.min !== null && lineup.length < teamSize.min ? (
          <div className="rp-warn-banner">
            ⚠ This event requires at least {teamSize.min} drivers - {lineup.length} added so far.
          </div>
        ) : teamSize.max !== null && lineup.length > teamSize.max ? (
          <div className="rp-warn-banner">
            ⚠ This event allows at most {teamSize.max} drivers - {lineup.length} added.
          </div>
        ) : null)}

      <div className="rp-row" style={{ marginBottom: 16 }}>
        <select className="rp-input" value={selectedProfileId} onChange={(e) => setSelectedProfileId(e.target.value)}>
          <option value="">All conditions (unfiltered)</option>
          {conditionProfiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <button className="rp-btn rp-primary" onClick={computeProfiles} disabled={computing || lineup.length === 0}>
          {computing ? "Computing…" : "Compute profiles"}
        </button>
      </div>

      {profiles.length > 0 && (
        <div className="rp-profile-list">
          {profiles.map((p) => (
            <div className="rp-card" key={p.custId}>
              <div className="rp-profile-row">
                <div>
                  <div className="rp-profile-label">{p.driverName}</div>
                  {p.ok ? (
                    <div className="rp-mono" style={{ marginTop: 4 }}>
                      {formatPace(p.paceMs)}
                      {p.widenedBand && (
                        <span className="rp-badge rp-amber" style={{ marginLeft: 8 }}>
                          Widened band
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="rp-text-faint" style={{ marginTop: 4 }}>
                      {p.reason === "no_laps_at_track" ? "No synced laps at this track yet" : "No clean laps found"}
                    </div>
                  )}
                  <div className="rp-text-faint" style={{ fontSize: 11, marginTop: 2 }}>
                    {p.lapsUsed} laps used · {p.sampleSize} in sample
                  </div>
                  {p.pitTimeSeconds !== null && (
                    <div className="rp-text-faint" style={{ fontSize: 11, marginTop: 2 }} title="Derived from this driver's own pit laps vs. their clean pace - includes in/out-lap execution, not just stationary time">
                      ~{p.pitTimeSeconds}s in the pits (derived)
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div className="rp-form-field">
                    <label>Fuel / lap (L)</label>
                    <input
                      className="rp-input"
                      style={{ width: 90 }}
                      type="number"
                      step="0.01"
                      placeholder={p.fuelPerLap !== null ? String(p.fuelPerLap) : "manual"}
                      value={fuelDrafts[p.custId] ?? ""}
                      onChange={(e) => setFuelDrafts({ ...fuelDrafts, [p.custId]: e.target.value })}
                    />
                  </div>
                  {p.fuelSource && <span className="rp-badge rp-dim">{p.fuelSource}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rp-row" style={{ marginTop: 20, justifyContent: "space-between" }}>
        {eventId && (
          <Link to={`/race-planner/conditions/${eventId}?planId=${planId}`} className="rp-btn">
            ← Back to conditions
          </Link>
        )}
        <Link to={`/race-planner/stints/${planId}`} className="rp-btn rp-primary">
          Continue to stints →
        </Link>
      </div>
    </div>
  );
}
