import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

type PlanSummary = {
  planId: string;
  name: string | null;
  carName: string | null;
  weekendId: string | null;
  weekendName: string | null;
  teamId: string | null;
  teamName: string | null;
  eventId: string | null;
  eventName: string | null;
  trackName: string | null;
  scheduledStartTime: string | null;
};

/**
 * "Plans" sidebar destination (coordinator navigation rebuild, 2026-07-22) - every Car
 * Entry the viewer can see across every team and weekend, grouped by team. Each row links
 * straight to that car's PlanSummaryPage.tsx, unchanged.
 */
export default function PlansListPage() {
  const [plans, setPlans] = useState<PlanSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/planner/plans", { credentials: "include" })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok || !data.ok) {
          setError(data.message ?? "Could not load your plans.");
          return;
        }
        setPlans(data.plans ?? []);
      })
      .catch(() => setError("Network error. Please try again."));
  }, []);

  if (error) return <p className="rp-error">{error}</p>;
  if (plans === null) return <p className="rp-section-sub">Loading…</p>;

  const groups = new Map<string, PlanSummary[]>();
  for (const p of plans) {
    const key = p.teamName ?? "Solo";
    const list = groups.get(key) ?? [];
    list.push(p);
    groups.set(key, list);
  }

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>Plans</h2>

      {plans.length === 0 ? (
        <p className="rp-section-sub">
          Nothing here yet - cars you create inside a race weekend will show up here once a race is picked.
        </p>
      ) : (
        [...groups.entries()].map(([teamName, list]) => (
          <div key={teamName} className="rp-card rp-card-narrow" style={{ marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>{teamName}</h3>
            <div className="rp-profile-list">
              {list.map((p) => (
                <div className="rp-row" key={p.planId} style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <div className="rp-profile-label">{p.carName ?? p.name ?? "Car"}</div>
                    <div className="rp-text-faint" style={{ fontSize: 11, marginTop: 2 }}>
                      {p.weekendName ?? p.eventName ?? "No race selected yet"}
                      {p.trackName ? ` · ${p.trackName}` : ""}
                      {p.scheduledStartTime ? ` · ${new Date(p.scheduledStartTime).toLocaleString()}` : ""}
                    </div>
                  </div>
                  <Link className="rp-btn" to={`/race-planner/plan/${p.planId}`}>
                    Open →
                  </Link>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
