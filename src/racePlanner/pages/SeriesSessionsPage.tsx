import { useEffect, useState } from "react";
import { useParams, useLocation, useNavigate, Link } from "react-router-dom";

type ScheduleSession = {
  seasonId: string;
  raceWeekNum: number;
  scheduleName?: string;
  trackName?: string;
  trackConfig?: string;
  specialEventType?: number;
  scheduledStartTime?: string;
  durationMinutes?: number;
  forecastAvailable: boolean;
  weatherUrl?: string;
};

type ExistingPlan = { id: string; name: string; updatedAt: string };

function formatDuration(minutes?: number): string {
  if (!minutes) return "—";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function SeriesSessionsPage() {
  const { seriesId } = useParams<{ seriesId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const seriesName = (location.state as { seriesName?: string } | null)?.seriesName ?? "Series";

  const [sessions, setSessions] = useState<ScheduleSession[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectingKey, setSelectingKey] = useState<string | null>(null);

  // Set when a selected session already has plan(s) the viewer can resume, so we can show
  // a resume-or-new prompt instead of jumping straight to Conditions.
  const [pendingChoice, setPendingChoice] = useState<{ eventId: string; existingPlans: ExistingPlan[] } | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);

  useEffect(() => {
    if (!seriesId) return;
    setLoading(true);
    setError(null);
    fetch(`/api/planner/series/${encodeURIComponent(seriesId)}/sessions`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (!data.ok) {
          setError(data.message ?? "Could not load sessions.");
          setSessions([]);
          return;
        }
        setSessions(data.sessions ?? []);
      })
      .catch(() => {
        setError("Network error. Please try again.");
        setSessions([]);
      })
      .finally(() => setLoading(false));
  }, [seriesId]);

  async function selectSession(session: ScheduleSession) {
    if (!seriesId) return;
    const key = `${session.seasonId}:${session.raceWeekNum}`;
    setSelectingKey(key);
    setError(null);
    try {
      const r = await fetch(`/api/planner/series/${encodeURIComponent(seriesId)}/select-session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...session, seriesId, seriesName }),
      });
      const data = await r.json().catch(() => ({}));

      if (!r.ok || !data.ok) {
        setError(data.message ?? "Could not select this session.");
        return;
      }

      if (data.newPlanId) {
        navigate(`/race-planner/conditions/${encodeURIComponent(data.event.id)}?planId=${encodeURIComponent(data.newPlanId)}`);
        return;
      }

      // Existing plan(s) already visible to this viewer - ask resume vs. start new
      // rather than silently picking one.
      setPendingChoice({ eventId: data.event.id, existingPlans: data.existingPlans ?? [] });
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSelectingKey(null);
    }
  }

  async function startNewPlan() {
    if (!pendingChoice) return;
    setCreatingNew(true);
    setError(null);
    try {
      const r = await fetch(`/api/planner/race-plans`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ eventId: pendingChoice.eventId }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setError(data.message ?? "Could not create a new plan.");
        return;
      }
      navigate(`/race-planner/conditions/${encodeURIComponent(pendingChoice.eventId)}?planId=${encodeURIComponent(data.plan.id)}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setCreatingNew(false);
    }
  }

  if (pendingChoice) {
    return (
      <div>
        <h2>Resume a plan?</h2>
        <p className="rp-section-sub" style={{ marginBottom: 16 }}>
          You already have {pendingChoice.existingPlans.length === 1 ? "a plan" : "plans"} for this event.
        </p>
        <div className="rp-profile-list">
          {pendingChoice.existingPlans.map((p) => (
            <div className="rp-card rp-profile-row" key={p.id}>
              <div>
                <div className="rp-profile-label">{p.name}</div>
                <div className="rp-text-faint" style={{ fontSize: 11, marginTop: 4 }}>
                  Updated {new Date(p.updatedAt).toLocaleString()}
                </div>
              </div>
              <Link
                to={`/race-planner/conditions/${encodeURIComponent(pendingChoice.eventId)}?planId=${encodeURIComponent(p.id)}`}
                className="rp-btn rp-primary"
              >
                Resume
              </Link>
            </div>
          ))}
        </div>
        <div className="rp-row" style={{ marginTop: 16 }}>
          <button className="rp-btn" onClick={startNewPlan} disabled={creatingNew}>
            {creatingNew ? "Creating…" : "Start a new plan instead"}
          </button>
          <button className="rp-btn" onClick={() => setPendingChoice(null)}>
            ← Back to sessions
          </button>
        </div>
        {error && <p className="rp-error">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <h2>{seriesName}</h2>
      <p className="rp-section-sub" style={{ marginBottom: 16 }}>
        Select the exact scheduled session you're planning for.
      </p>

      {error && <p className="rp-error">{error}</p>}
      {loading && <p className="rp-section-sub">Loading…</p>}

      {sessions !== null && sessions.length === 0 && !loading && (
        <div className="rp-card">No scheduled sessions found for this series.</div>
      )}

      {sessions !== null && sessions.length > 0 && (
        <div className="rp-event-grid">
          {sessions.map((s) => {
            const key = `${s.seasonId}:${s.raceWeekNum}`;
            return (
              <div className="rp-event-card" key={key}>
                <h3 className="rp-event-track">{s.scheduleName ?? seriesName}</h3>
                {(s.trackName || s.trackConfig) && (
                  <div className="rp-event-meta">
                    <span>Track</span>
                    <span className="rp-mono">
                      {s.trackName}
                      {s.trackConfig ? ` — ${s.trackConfig}` : ""}
                    </span>
                  </div>
                )}
                {s.scheduledStartTime && (
                  <div className="rp-event-meta">
                    <span>Start</span>
                    <span className="rp-mono">{new Date(s.scheduledStartTime).toLocaleString()}</span>
                  </div>
                )}
                <div className="rp-event-meta">
                  <span>Duration</span>
                  <span className="rp-mono">{formatDuration(s.durationMinutes)}</span>
                </div>
                <div className="rp-event-meta">
                  <span>Forecast</span>
                  {s.forecastAvailable ? (
                    <span className="rp-badge rp-green">Available</span>
                  ) : (
                    <span className="rp-badge rp-dim">Not available</span>
                  )}
                </div>
                <button
                  className="rp-btn rp-primary"
                  style={{ marginTop: 8, alignSelf: "flex-start" }}
                  onClick={() => selectSession(s)}
                  disabled={selectingKey === key}
                >
                  {selectingKey === key ? "Selecting…" : "Select"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="rp-row" style={{ marginTop: 20 }}>
        <Link to="/race-planner" className="rp-btn">
          ← Back to series
        </Link>
      </div>
    </div>
  );
}
