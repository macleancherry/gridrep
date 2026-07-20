import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useRacePlannerViewer } from "../useRacePlannerViewer";

type TeamSummary = { id: string; name: string; isCreator: boolean };
type Garage61TeamSummary = { id: string; name: string };

/**
 * Entry point for the coordinator team flow (PRD: "create/manage a team"). Lists teams the
 * viewer already coordinates or belongs to, plus a create-a-team form. This is a functional
 * stopgap for the real jobs-to-be-done home page (PRD phase 5) - reachable directly today
 * so the rest of Phase 2 can be built and tested end-to-end before that navigation lands.
 */
export default function TeamListPage() {
  const navigate = useNavigate();
  const viewer = useRacePlannerViewer();
  const [teams, setTeams] = useState<TeamSummary[] | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showG61Picker, setShowG61Picker] = useState(false);
  const [g61Teams, setG61Teams] = useState<Garage61TeamSummary[] | null>(null);
  const [selectedG61TeamId, setSelectedG61TeamId] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

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

  function openG61Picker() {
    setShowG61Picker(true);
    setImportError(null);
    if (g61Teams !== null) return;
    fetch("/api/planner/garage61/teams", { credentials: "include" })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok || !data.ok) {
          setImportError(data.message ?? "Could not load your Garage 61 teams.");
          setG61Teams([]);
          return;
        }
        setG61Teams(data.teams ?? []);
      })
      .catch(() => {
        setImportError("Network error. Please try again.");
        setG61Teams([]);
      });
  }

  async function importSelectedTeam() {
    const g61Team = (g61Teams ?? []).find((t) => t.id === selectedG61TeamId);
    if (!g61Team) return;
    setImporting(true);
    setImportError(null);
    try {
      const createRes = await fetch("/api/planner/teams", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: g61Team.name }),
      });
      const createData = await createRes.json().catch(() => ({}));
      if (!createRes.ok || !createData.ok) {
        setImportError(createData.message ?? "Could not create the team.");
        return;
      }

      const importRes = await fetch(`/api/planner/teams/${encodeURIComponent(createData.team.id)}/import-garage61`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ g61TeamId: g61Team.id }),
      });
      const importData = await importRes.json().catch(() => ({}));
      if (!importRes.ok || !importData.ok) {
        // The team itself was created fine - just couldn't pull the roster. Send them
        // there anyway rather than leaving them stuck on this page with nothing to show.
        navigate(`/race-planner/team/${createData.team.id}`);
        return;
      }

      navigate(`/race-planner/team/${createData.team.id}`);
    } catch {
      setImportError("Network error. Please try again.");
    } finally {
      setImporting(false);
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

      {viewer.verified && viewer.garage61Connected && (
        <div className="rp-card rp-card-narrow" style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Or import a team from Garage 61</h3>
          <p className="rp-section-sub">Already set up over there? Pull in the name and roster in one go.</p>
          {!showG61Picker ? (
            <button className="rp-btn" onClick={openG61Picker}>
              Import from Garage 61
            </button>
          ) : g61Teams === null ? (
            <p className="rp-section-sub">Loading your Garage 61 teams…</p>
          ) : g61Teams.length === 0 ? (
            <p className="rp-section-sub">No Garage 61 teams found for your connected account.</p>
          ) : (
            <div className="rp-row" style={{ flexWrap: "wrap" }}>
              <select className="rp-input" value={selectedG61TeamId} onChange={(e) => setSelectedG61TeamId(e.target.value)}>
                <option value="">Choose a team…</option>
                {g61Teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button className="rp-btn rp-primary" onClick={importSelectedTeam} disabled={!selectedG61TeamId || importing}>
                {importing ? "Importing…" : "Import"}
              </button>
            </div>
          )}
          {importError && <p className="rp-error">{importError}</p>}
        </div>
      )}
    </div>
  );
}
