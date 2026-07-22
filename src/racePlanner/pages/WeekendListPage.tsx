import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { titleCaseRaceName } from "../format";

type WeekendSummary = {
  weekendId: string;
  name: string;
  teamId: string | null;
  teamName: string | null;
  trackName: string | null;
  scheduledStartTime: string | null;
  carCount: number;
};

/**
 * "Race Weekends" sidebar destination (coordinator navigation rebuild, 2026-07-22) - every
 * weekend the viewer can see across every team, plus a solo weekend they created
 * themselves. Reached from the sidebar with no team/weekend already in context; each row
 * links into RaceWeekendPage.tsx's checklist hub, the same page TeamPage.tsx's own
 * per-team weekend list already links to.
 */
export default function WeekendListPage() {
  const [weekends, setWeekends] = useState<WeekendSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/planner/race-weekends", { credentials: "include" })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok || !data.ok) {
          setError(data.message ?? "Could not load your race weekends.");
          return;
        }
        setWeekends(data.weekends ?? []);
      })
      .catch(() => setError("Network error. Please try again."));
  }, []);

  if (error) return <p className="rp-error">{error}</p>;
  if (weekends === null) return <p className="rp-section-sub">Loading…</p>;

  return (
    <div>
      <div className="rp-row" style={{ justifyContent: "space-between", flexWrap: "wrap", marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Race weekends</h2>
        <Link className="rp-btn rp-primary" to="/race-planner/weekend/new">
          + Create a race weekend
        </Link>
      </div>

      {weekends.length === 0 ? (
        <p className="rp-section-sub">
          Nothing planned yet. Create a race weekend to start adding cars, picking races, and bringing in drivers.
        </p>
      ) : (
        <div className="rp-profile-list">
          {weekends.map((w) => (
            <div className="rp-row" key={w.weekendId} style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div>
                <div className="rp-profile-label">{titleCaseRaceName(w.name) || w.name}</div>
                <div className="rp-text-faint" style={{ fontSize: 11, marginTop: 2 }}>
                  {w.teamName ?? "Solo"}
                  {" · "}
                  {w.trackName ?? "Track TBD"}
                  {w.scheduledStartTime ? ` · ${new Date(w.scheduledStartTime).toLocaleString()}` : ""}
                  {w.carCount > 0 ? ` · ${w.carCount} car${w.carCount === 1 ? "" : "s"}` : " · no cars yet"}
                </div>
              </div>
              <Link className="rp-btn rp-primary" to={`/race-planner/weekend/${w.weekendId}`}>
                {w.carCount === 0 ? "Add cars →" : "Manage →"}
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
