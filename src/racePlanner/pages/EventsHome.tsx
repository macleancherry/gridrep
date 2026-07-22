import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

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
  const [searchParams] = useSearchParams();
  // Carried through from TeamPage's "Plan a race for this team" button so the session
  // picker's team selector can pre-select it directly, rather than relying on the
  // "exactly one coordinated team" auto-select which doesn't help a coordinator of more
  // than one team.
  const preselectedTeamId = searchParams.get("teamId");
  // Carried through from a Car Entry's "Select race →" step on RaceWeekendPage.tsx's
  // checklist - when present, selecting a session attaches its event to this already-
  // existing car (select-session.ts's planId-attach mode) instead of creating a new plan,
  // and the picker returns to that weekend's checklist afterward instead of Conditions.
  const attachPlanId = searchParams.get("planId");
  const attachWeekendId = searchParams.get("weekendId");
  const [query, setQuery] = useState("");
  const [series, setSeries] = useState<SeriesSummary[] | null>(null);
  const [tailored, setTailored] = useState(false);
  const [hasPreferences, setHasPreferences] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load the full tailored list once - filtering as you type happens entirely
  // client-side below, no per-keystroke request to iRacing.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/planner/series`, { credentials: "include" })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (cancelled) return;
        if (!ok || !data.ok) {
          setError(data.message ?? "Could not load series.");
          setSeries([]);
          return;
        }
        setSeries(data.series ?? []);
        setTailored(Boolean(data.tailored));
        setHasPreferences(Boolean(data.hasPreferences));
      })
      .catch(() => {
        if (!cancelled) {
          setError("Network error. Please try again.");
          setSeries([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleSeries = useMemo(() => {
    if (!series) return null;
    const q = query.trim().toLowerCase();
    return q ? series.filter((s) => s.name.toLowerCase().includes(q)) : series;
  }, [series, query]);

  return (
    <div>
      <h2>Select a series</h2>
      <p className="rp-section-sub" style={{ marginBottom: 16 }}>
        Pick a series, then the exact scheduled running you're planning for.
      </p>

      <div className="rp-row" style={{ marginBottom: 8 }}>
        <input
          className="rp-input"
          placeholder="Filter by name (e.g. Spa)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ minWidth: 220 }}
        />
      </div>

      {error && <p className="rp-error">{error}</p>}

      {loading && <p className="rp-section-sub">Loading series…</p>}

      {visibleSeries !== null && !loading && (
        <p className="rp-section-sub" style={{ marginBottom: 12 }}>
          {tailored ? (
            <span className="rp-badge rp-green">Tailored to your preferences</span>
          ) : hasPreferences && series && series.length > 0 ? (
            <>
              Nothing matched your preferences — showing everything.{" "}
              <Link to="/race-planner/welcome?edit=1">Update your preferences →</Link>
            </>
          ) : !hasPreferences ? (
            <Link to="/race-planner/welcome?edit=1">Set your racing preferences to tailor these results →</Link>
          ) : null}
        </p>
      )}

      {visibleSeries !== null && visibleSeries.length === 0 && !loading && (
        <div className="rp-card rp-card-narrow">
          {series && series.length > 0 ? "No series match that filter." : "No series found for your preferences."}
        </div>
      )}

      {visibleSeries !== null && visibleSeries.length > 0 && (
        <div className="rp-event-grid">
          {visibleSeries.map((s) => (
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
                onClick={() =>
                  navigate(`/race-planner/series/${encodeURIComponent(s.seriesId)}`, {
                    state: { seriesName: s.name, preselectedTeamId, attachPlanId, attachWeekendId },
                  })
                }
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
