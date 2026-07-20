import { useEffect, useMemo, useState } from "react";
import { useParams, useLocation, useNavigate, Link } from "react-router-dom";

type ScheduleSession = {
  seasonId: string;
  raceWeekNum: number;
  scheduleName?: string;
  trackName?: string;
  trackConfig?: string;
  specialEventType?: number;
  scheduledStartTime?: string;
  slotIndex: number;
  slotCount: number;
  practiceLengthMinutes?: number;
  qualifyLengthMinutes?: number;
  warmupLengthMinutes?: number;
  raceLengthMinutes?: number;
  forecastAvailable: boolean;
  weatherUrl?: string;
  forecastSummary?: { tempLowC: number; tempHighC: number; precipChancePct: number };
  minTeamDrivers?: number;
  maxTeamDrivers?: number;
};

type ExistingPlan = { id: string; name: string; updatedAt: string };
type TeamSummary = { id: string; name: string; isCreator: boolean };

function formatDuration(minutes?: number): string {
  if (!minutes) return "—";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function phaseSummary(s: ScheduleSession): string {
  const parts: string[] = [];
  if (s.practiceLengthMinutes) parts.push(`Practice ${formatDuration(s.practiceLengthMinutes)}`);
  if (s.qualifyLengthMinutes) parts.push(`Qualifying ${formatDuration(s.qualifyLengthMinutes)}`);
  if (s.warmupLengthMinutes) parts.push(`Warmup ${formatDuration(s.warmupLengthMinutes)}`);
  parts.push(`Race ${formatDuration(s.raceLengthMinutes)}`);
  return parts.join(" · ");
}

// scheduledStartTime is when PRACTICE opens (real-world), not the green flag - add back
// the practice+qualifying+warmup lead-in to find when the race itself actually ends, so a
// session already fully run isn't offered as something new to plan for. A slot with no
// known start time (Time TBD) is never filtered - there's nothing to compare against.
function hasEnded(s: ScheduleSession): boolean {
  if (!s.scheduledStartTime) return false;
  const startMs = Date.parse(s.scheduledStartTime);
  if (!Number.isFinite(startMs)) return false;
  const raceStartOffsetMinutes = (s.practiceLengthMinutes ?? 0) + (s.qualifyLengthMinutes ?? 0) + (s.warmupLengthMinutes ?? 0);
  const endMs = startMs + (raceStartOffsetMinutes + (s.raceLengthMinutes ?? 0)) * 60_000;
  return endMs < Date.now();
}

// The API returns one flat row per real-world start-time slot; group them back into
// one card per schedule entry (same track/session lengths, different start times) so
// the picker doesn't repeat identical track/duration info once per slot.
function groupBySchedule(sessions: ScheduleSession[]): ScheduleSession[][] {
  const groups = new Map<string, ScheduleSession[]>();
  for (const s of sessions) {
    const key = `${s.seasonId}:${s.raceWeekNum}`;
    const existing = groups.get(key);
    if (existing) existing.push(s);
    else groups.set(key, [s]);
  }
  return Array.from(groups.values()).map((g) => [...g].sort((a, b) => a.slotIndex - b.slotIndex));
}

export default function SeriesSessionsPage() {
  const { seriesId } = useParams<{ seriesId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const navState = location.state as { seriesName?: string; preselectedTeamId?: string | null } | null;
  const seriesName = navState?.seriesName ?? "Series";
  const preselectedTeamId = navState?.preselectedTeamId ?? null;

  const [sessions, setSessions] = useState<ScheduleSession[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectingKey, setSelectingKey] = useState<string | null>(null);

  // A coordinator can plan this weekend for one of their teams instead of just
  // themselves - the roster/lineup pages can then quick-add from that team's roster
  // rather than searching iRacing globally for every driver.
  const [teams, setTeams] = useState<TeamSummary[] | null>(null);
  const [teamId, setTeamId] = useState<string>("");

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

  useEffect(() => {
    fetch(`/api/planner/teams`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (!data?.ok) return;
        const coordinated: TeamSummary[] = (data.teams ?? []).filter((t: TeamSummary) => t.isCreator);
        setTeams(coordinated);
        if (preselectedTeamId && coordinated.some((t) => t.id === preselectedTeamId)) {
          // Arrived here via TeamPage's "Plan a race for this team" - honor that team
          // explicitly rather than falling through to the single-team default below.
          setTeamId(preselectedTeamId);
        } else if (coordinated.length === 1) {
          // Coordinators with exactly one team are almost always planning for it - default
          // to it instead of making them remember to pick it every time (still overridable,
          // and a coordinator with more than one team still gets an explicit choice).
          setTeamId(coordinated[0].id);
        }
      })
      .catch(() => {});
  }, []);

  // Hide sessions whose race has already run - there's nothing to plan for once it's over.
  const upcomingSessions = useMemo(() => (sessions ?? []).filter((s) => !hasEnded(s)), [sessions]);
  const pastCount = (sessions?.length ?? 0) - upcomingSessions.length;

  async function selectSession(session: ScheduleSession) {
    if (!seriesId) return;
    const key = `${session.seasonId}:${session.raceWeekNum}:${session.slotIndex}`;
    setSelectingKey(key);
    setError(null);
    try {
      const r = await fetch(`/api/planner/series/${encodeURIComponent(seriesId)}/select-session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ...session, seriesId, seriesName, teamId: teamId || null }),
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
        body: JSON.stringify({ eventId: pendingChoice.eventId, teamId: teamId || null }),
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

      {teams && teams.length > 0 && (
        <div className="rp-card rp-card-narrow" style={{ marginBottom: 16 }}>
          <label className="rp-text-faint" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", display: "block", marginBottom: 6 }}>
            Planning this for a team?
          </label>
          <select className="rp-input" style={{ width: "100%" }} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
            <option value="">Just me — no team</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {teamId && (
            <p className="rp-section-sub" style={{ marginTop: 6 }}>
              Lineup will let you quick-add straight from this team's roster.
            </p>
          )}
        </div>
      )}

      {error && <p className="rp-error">{error}</p>}
      {loading && <p className="rp-section-sub">Loading…</p>}

      {sessions !== null && sessions.length === 0 && !loading && (
        <div className="rp-card rp-card-narrow">No scheduled sessions found for this series.</div>
      )}

      {sessions !== null && sessions.length > 0 && upcomingSessions.length === 0 && !loading && (
        <div className="rp-card rp-card-narrow">
          Every scheduled session for this series has already run — nothing left to plan for yet.
        </div>
      )}

      {pastCount > 0 && upcomingSessions.length > 0 && (
        <p className="rp-section-sub" style={{ marginBottom: 12 }}>
          {pastCount} already-run session{pastCount === 1 ? "" : "s"} hidden.
        </p>
      )}

      {upcomingSessions.length > 0 && (
        <div className="rp-event-grid">
          {groupBySchedule(upcomingSessions).map((group) => {
            const s = group[0];
            const cardKey = `${s.seasonId}:${s.raceWeekNum}`;
            return (
              <div className="rp-event-card" key={cardKey}>
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
                <div className="rp-event-meta">
                  <span>Sessions</span>
                  <span className="rp-mono">{phaseSummary(s)}</span>
                </div>
                <div className="rp-event-meta">
                  <span>Forecast</span>
                  {s.forecastAvailable ? (
                    <span className="rp-badge rp-green">
                      {s.forecastSummary
                        ? `${s.forecastSummary.tempLowC}–${s.forecastSummary.tempHighC}°C · ${s.forecastSummary.precipChancePct}% rain`
                        : "Available"}
                    </span>
                  ) : (
                    <span className="rp-badge rp-dim">Not available</span>
                  )}
                </div>
                {s.minTeamDrivers !== undefined && (
                  <div className="rp-event-meta">
                    <span>Team size</span>
                    <span className="rp-mono">
                      {s.minTeamDrivers}
                      {s.maxTeamDrivers !== undefined && s.maxTeamDrivers !== s.minTeamDrivers ? `–${s.maxTeamDrivers}` : ""} drivers
                    </span>
                  </div>
                )}

                {group.length > 1 ? (
                  <div style={{ marginTop: 8 }}>
                    <div className="rp-text-faint" style={{ fontSize: 11, marginBottom: 6 }}>
                      Pick the real-world start time your team is joining ({group.length} options):
                    </div>
                    <div className="rp-profile-list">
                      {group.map((slot) => {
                        const key = `${slot.seasonId}:${slot.raceWeekNum}:${slot.slotIndex}`;
                        return (
                          <div className="rp-row" key={key} style={{ justifyContent: "space-between" }}>
                            <span className="rp-mono" style={{ fontSize: 12.5 }}>
                              {slot.scheduledStartTime ? new Date(slot.scheduledStartTime).toLocaleString() : "Time TBD"}
                              <span className="rp-text-faint"> (practice opens)</span>
                            </span>
                            <button className="rp-btn rp-primary" onClick={() => selectSession(slot)} disabled={selectingKey === key}>
                              {selectingKey === key ? "Selecting…" : "Select"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <>
                    {s.scheduledStartTime && (
                      <div className="rp-event-meta">
                        <span>Start</span>
                        <span className="rp-mono">{new Date(s.scheduledStartTime).toLocaleString()}</span>
                      </div>
                    )}
                    <button
                      className="rp-btn rp-primary"
                      style={{ marginTop: 8, alignSelf: "flex-start" }}
                      onClick={() => selectSession(s)}
                      disabled={selectingKey === `${s.seasonId}:${s.raceWeekNum}:${s.slotIndex}`}
                    >
                      {selectingKey === `${s.seasonId}:${s.raceWeekNum}:${s.slotIndex}` ? "Selecting…" : "Select"}
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="rp-row" style={{ marginTop: 20 }}>
        <Link to="/race-planner/series" className="rp-btn">
          ← Back to series
        </Link>
      </div>
    </div>
  );
}
