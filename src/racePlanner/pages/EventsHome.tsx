import { useState } from "react";
import { useNavigate } from "react-router-dom";

type SeriesSummary = { seriesId: string; name: string };

export default function EventsHome() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [series, setSeries] = useState<SeriesSummary[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());

      const r = await fetch(`/api/planner/series?${params.toString()}`, { credentials: "include" });
      const data = await r.json().catch(() => ({}));

      if (!r.ok || !data.ok) {
        setError(data.message ?? "Could not load series.");
        setSeries([]);
        return;
      }

      setSeries(data.series ?? []);
    } catch {
      setError("Network error. Please try again.");
      setSeries([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2>Select a series</h2>
      <p className="rp-section-sub" style={{ marginBottom: 16 }}>
        Special &amp; endurance team events — pick a series, then the exact scheduled running you're planning for.
      </p>

      <div className="rp-row" style={{ marginBottom: 8 }}>
        <input
          className="rp-input"
          placeholder="Search by name (e.g. Spa)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          style={{ minWidth: 220 }}
        />
        <button className="rp-btn rp-primary" onClick={search} disabled={loading}>
          {loading ? "Searching…" : "Search"}
        </button>
      </div>

      {error && <p className="rp-error">{error}</p>}

      {series === null && !loading && (
        <div className="rp-card">Search to browse upcoming special/endurance team series from iRacing.</div>
      )}

      {series !== null && series.length === 0 && !loading && (
        <div className="rp-card">No series found. Try a different search term.</div>
      )}

      {series !== null && series.length > 0 && (
        <div className="rp-event-grid">
          {series.map((s) => (
            <div className="rp-event-card" key={s.seriesId}>
              <h3 className="rp-event-track">{s.name}</h3>
              <button
                className="rp-btn rp-primary"
                style={{ marginTop: 8, alignSelf: "flex-start" }}
                onClick={() => navigate(`/race-planner/series/${encodeURIComponent(s.seriesId)}`, { state: { seriesName: s.name } })}
              >
                View sessions →
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
