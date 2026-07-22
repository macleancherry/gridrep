import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { titleCaseRaceName } from "../format";

type PlanSummary = {
  planId: string;
  name: string | null;
  carName: string | null;
  weekendName: string | null;
  teamName: string | null;
  eventName: string | null;
  seriesName: string | null;
  trackName: string | null;
  scheduledStartTime: string | null;
};

/**
 * "Live" sidebar destination (coordinator navigation rebuild, 2026-07-22) - every Car
 * Entry the viewer can see that's currently linked to live tracking, across every team and
 * weekend. Each row links straight to that car's LivePage.tsx, unchanged.
 */
export default function LiveListPage() {
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/planner/live", { credentials: "include" })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok || !data.ok) {
          setError(data.message ?? "Could not load live sessions.");
          return;
        }
        setPlans(data.plans ?? []);
      })
      .catch(() => setError("Network error. Please try again."));
  }, []);

  if (error) return <p className="rp-error">{error}</p>;
  if (plans === null) return <p className="rp-section-sub">Loading…</p>;

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>Live</h2>

      {plans.length === 0 ? (
        <p className="rp-section-sub">
          Nothing live right now - link a subsession from a car's Live page once its race is underway.
        </p>
      ) : (
        <div className="rp-profile-list">
          {plans.map((p) => (
            <div className="rp-row" key={p.planId} style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
              <div>
                <div className="rp-profile-label">{p.carName ?? p.name ?? "Car"}</div>
                <div className="rp-text-faint" style={{ fontSize: 11, marginTop: 2 }}>
                  {p.teamName ?? "Solo"}
                  {" · "}
                  {titleCaseRaceName(p.weekendName) || p.seriesName || titleCaseRaceName(p.eventName)}
                  {p.trackName ? ` · ${p.trackName}` : ""}
                </div>
              </div>
              <Link className="rp-btn rp-primary" to={`/race-planner/live/${p.planId}`}>
                Watch →
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
