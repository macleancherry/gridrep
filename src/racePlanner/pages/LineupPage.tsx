import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";

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
  const { eventId } = useParams<{ eventId: string }>();
  const [lineup, setLineup] = useState<{ custId: string; name: string }[]>([]);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<DriverSearchResult[]>([]);
  const [conditionProfiles, setConditionProfiles] = useState<ConditionProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [profiles, setProfiles] = useState<DriverProfile[]>([]);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fuelDrafts, setFuelDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!eventId) return;
    fetch(`/api/planner/events/${encodeURIComponent(eventId)}/conditions`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setConditionProfiles(data.profiles ?? []))
      .catch(() => setConditionProfiles([]));
  }, [eventId]);

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
    setLineup([...lineup, { custId, name }]);
    setQuery("");
    setSearchResults([]);
  }

  function removeDriver(custId: string) {
    setLineup(lineup.filter((d) => d.custId !== custId));
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

  return (
    <div>
      <h2>Driver lineup</h2>
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
        <Link to={`/race-planner/conditions/${eventId}`} className="rp-btn">
          ← Back to conditions
        </Link>
        <Link to={`/race-planner/stints/${eventId}`} className="rp-btn rp-primary">
          Continue to stints →
        </Link>
      </div>
    </div>
  );
}
