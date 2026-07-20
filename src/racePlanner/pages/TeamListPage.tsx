import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

type TeamSummary = { id: string; name: string; isCreator: boolean };

/**
 * Entry point for the coordinator team flow (PRD: "create/manage a team"). Lists teams the
 * viewer already coordinates or belongs to, plus a create-a-team form. This is a functional
 * stopgap for the real jobs-to-be-done home page (PRD phase 5) - reachable directly today
 * so the rest of Phase 2 can be built and tested end-to-end before that navigation lands.
 */
export default function TeamListPage() {
  const navigate = useNavigate();
  const [teams, setTeams] = useState<TeamSummary[] | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/planner/teams", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => setTeams(data.ok ? data.teams : []))
      .catch(() => setTeams([]));
  }, []);

  async function createTeam() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCreating(true);
    setError(null);
    try {
      const r = await fetch("/api/planner/teams", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setError(data.message ?? "Could not create the team.");
        return;
      }
      navigate(`/race-planner/team/${data.team.id}`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <h2>Your teams</h2>
      <p className="rp-section-sub" style={{ marginBottom: 16 }}>
        A team is a persistent roster you build once and plan race weekends against.
      </p>

      {teams === null && <p className="rp-section-sub">Loading…</p>}

      {teams !== null && teams.length > 0 && (
        <div className="rp-event-grid" style={{ marginBottom: 24 }}>
          {teams.map((t) => (
            <div className="rp-event-card" key={t.id}>
              <h3 className="rp-event-track">{t.name}</h3>
              {t.isCreator && <span className="rp-badge rp-dim">Coordinator</span>}
              <Link className="rp-btn rp-primary" style={{ marginTop: 8, alignSelf: "flex-start" }} to={`/race-planner/team/${t.id}`}>
                Manage →
              </Link>
            </div>
          ))}
        </div>
      )}

      <div className="rp-card rp-card-narrow">
        <h3 style={{ marginTop: 0 }}>Create a new team</h3>
        <div className="rp-row" style={{ marginTop: 8 }}>
          <input
            className="rp-input"
            placeholder="Team name (e.g. Ignium Motorsport)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ minWidth: 240 }}
          />
          <button className="rp-btn rp-primary" onClick={createTeam} disabled={creating || !name.trim()}>
            {creating ? "Creating…" : "Create team"}
          </button>
        </div>
        {error && <p className="rp-error">{error}</p>}
      </div>
    </div>
  );
}
