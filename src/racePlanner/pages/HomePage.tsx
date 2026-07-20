import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";

const ICON_PROPS = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6 } as const;

type TeamSummary = { id: string; name: string; isCreator: boolean };

/**
 * The app's real front door (PRD: "jobs to be done" navigation model) - replaces what used
 * to be EventsHome.tsx landing directly on series search, a page that only makes sense once
 * you already know why you're here. Extends WelcomePage.tsx's existing card-grid visual
 * language rather than inventing a new one.
 *
 * A returning coordinator with an existing team skips the picker entirely and lands on
 * their team dashboard - the picker is for establishing context on a first visit, not a
 * wall to click through every time.
 */
export default function HomePage() {
  const navigate = useNavigate();
  const [teams, setTeams] = useState<TeamSummary[] | null>(null);

  useEffect(() => {
    fetch("/api/planner/teams", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setTeams(data.ok ? data.teams : []))
      .catch(() => setTeams([]));
  }, []);

  const coordinatedTeams = (teams ?? []).filter((t) => t.isCreator);

  useEffect(() => {
    if (coordinatedTeams.length === 1) {
      navigate(`/race-planner/team/${coordinatedTeams[0].id}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams]);

  if (teams === null || coordinatedTeams.length === 1) {
    return <p className="rp-section-sub">Loading…</p>;
  }

  return (
    <div>
      <h1 className="rp-welcome-title">What are you here to do?</h1>
      <p className="rp-section-sub" style={{ marginBottom: 28 }}>
        {coordinatedTeams.length > 1
          ? "You coordinate more than one team - pick one below, or start planning a race."
          : "Pick whichever fits - you can always come back and do the other."}
      </p>

      {coordinatedTeams.length > 1 && (
        <div className="rp-welcome-section">
          <h2 className="rp-welcome-section-title">Your teams</h2>
          <div className="rp-event-grid" style={{ marginBottom: 20 }}>
            {coordinatedTeams.map((t) => (
              <div className="rp-event-card" key={t.id}>
                <h3 className="rp-event-track">{t.name}</h3>
                <Link className="rp-btn rp-primary" style={{ marginTop: 8, alignSelf: "flex-start" }} to={`/race-planner/team/${t.id}`}>
                  Manage →
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rp-welcome-grid">
        <button type="button" className="rp-welcome-card" onClick={() => navigate("/race-planner/team")}>
          <span className="rp-welcome-card-icon">
            <svg {...ICON_PROPS}>
              <circle cx="8.5" cy="8" r="3" />
              <path d="M2.5 20c0-3.8 2.7-6 6-6s6 2.2 6 6" />
              <circle cx="17" cy="9" r="2.4" />
              <path d="M14.5 15.5c2.7.3 4.5 2 4.5 5.5" />
            </svg>
          </span>
          <span className="rp-welcome-card-title">Create or manage a team</span>
          <span className="rp-welcome-card-desc">Build your roster, invite drivers, plan race weekends together.</span>
        </button>

        <button type="button" className="rp-welcome-card" onClick={() => navigate("/race-planner/series")}>
          <span className="rp-welcome-card-icon">
            <svg {...ICON_PROPS}>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3.5 2" />
            </svg>
          </span>
          <span className="rp-welcome-card-title">Plan a race</span>
          <span className="rp-welcome-card-desc">Search for a series and session — solo, or for a team you coordinate.</span>
        </button>
      </div>

      <p className="rp-text-faint" style={{ marginTop: 24, fontSize: 12 }}>
        Invited to a team by a coordinator? Use the link they sent you instead of this page.
      </p>
    </div>
  );
}
