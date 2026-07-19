import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

type SeriesSummary = {
  seriesId: string;
  name: string;
  formats: ("sprint" | "endurance" | "special")[];
  disciplines: ("road" | "oval" | "dirt_road" | "dirt_oval")[];
};

const FORMAT_LABEL: Record<string, string> = { sprint: "Sprint", endurance: "Endurance", special: "Special Event" };
const DISCIPLINE_LABEL: Record<string, string> = { road: "Road", oval: "Oval", dirt_road: "Dirt Road", dirt_oval: "Dirt Oval" };

export default function EventsHome() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [series, setSeries] = useState<SeriesSummary[] | null>(null);
  const [tailored, setTailored] = useState(false);
  const [hasPreferences, setHasPreferences] = useState(false);
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
      setTailored(Boolean(data.tailored));
      setHasPreferences(Boolean(data.hasPreferences));
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
        Pick a series, then the exact scheduled running you're planning for.
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

      {series !== null && !loading && (
        <p className="rp-section-sub" style={{ marginBottom: 12 }}>
          {tailored ? (
            <span className="rp-badge rp-green">Tailored to your preferences</span>
          ) : hasPreferences && series.length > 0 ? (
            <>
              Nothing matched your preferences — showing everything.{" "}
              <Link to="/race-planner/welcome?edit=1">Update your preferences →</Link>
            </>
          ) : !hasPreferences ? (
            <Link to="/race-planner/welcome?edit=1">Set your racing preferences to tailor these results →</Link>
          ) : null}
        </p>
      )}

      {series === null && !loading && (
        <div className="rp-card rp-card-narrow">Search to browse upcoming series from iRacing.</div>
      )}

      {series !== null && series.length === 0 && !loading && (
        <div className="rp-card rp-card-narrow">No series found. Try a different search term.</div>
      )}

      {series !== null && series.length > 0 && (
        <div className="rp-event-grid">
          {series.map((s) => (
            <div className="rp-event-card" key={s.seriesId}>
              <h3 className="rp-event-track">{s.name}</h3>
              {(s.formats.length > 0 || s.disciplines.length > 0) && (
                <div className="rp-row" style={{ flexWrap: "wrap", gap: 6 }}>
                  {s.formats.map((f) => (
                    <span className="rp-badge rp-dim" key={f}>
                      {FORMAT_LABEL[f] ?? f}
                    </span>
                  ))}
                  {s.disciplines.map((d) => (
                    <span className="rp-badge rp-dim" key={d}>
                      {DISCIPLINE_LABEL[d] ?? d}
                    </span>
                  ))}
                </div>
              )}
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
