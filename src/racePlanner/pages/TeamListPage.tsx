import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useRacePlannerViewer } from "../useRacePlannerViewer";

type TeamSummary = { id: string; name: string; isCreator: boolean };
type Garage61TeamSummary = { id: string; name: string };
type Garage61Member = { custId: string | null; name: string };

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
  const [g61Members, setG61Members] = useState<Garage61Member[] | null>(null);
  const [loadingG61Members, setLoadingG61Members] = useState(false);
  const [importTeamName, setImportTeamName] = useState("");
  const [selectedCustIds, setSelectedCustIds] = useState<Set<string>>(new Set());
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

  // Loads that Garage 61 team's members so the coordinator can pick a gridrep team name
  // and choose exactly who comes onto the roster - never silently inherited/imported in
  // bulk. All custId-having members start checked (still zero extra clicks for "import
  // everyone"), but every one is visible and can be unchecked before anything is created.
  async function selectG61Team(g61TeamId: string) {
    setSelectedG61TeamId(g61TeamId);
    setG61Members(null);
    setSelectedCustIds(new Set());
    setImportError(null);
    if (!g61TeamId) return;

    setLoadingG61Members(true);
    try {
      const r = await fetch(`/api/planner/garage61/teams/${encodeURIComponent(g61TeamId)}/members`, { credentials: "include" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setImportError(data.message ?? "Could not load that Garage 61 team's roster.");
        return;
      }
      const members: Garage61Member[] = data.members ?? [];
      setG61Members(members);
      setImportTeamName(data.teamName ?? "");
      setSelectedCustIds(new Set(members.filter((m) => m.custId).map((m) => m.custId as string)));
    } catch {
      setImportError("Network error. Please try again.");
    } finally {
      setLoadingG61Members(false);
    }
  }

  function toggleG61Member(custId: string) {
    setSelectedCustIds((prev) => {
      const next = new Set(prev);
      if (next.has(custId)) next.delete(custId);
      else next.add(custId);
      return next;
    });
  }

  async function importSelectedTeam() {
    const trimmedName = importTeamName.trim();
    if (!selectedG61TeamId || !trimmedName) return;
    setImporting(true);
    setImportError(null);
    try {
      const createRes = await fetch("/api/planner/teams", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: trimmedName }),
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
        body: JSON.stringify({ g61TeamId: selectedG61TeamId, custIds: [...selectedCustIds] }),
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
                {t.isCreator ? "Manage →" : "View team →"}
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
            <div>
              <div className="rp-row" style={{ flexWrap: "wrap" }}>
                <select className="rp-input" value={selectedG61TeamId} onChange={(e) => selectG61Team(e.target.value)}>
                  <option value="">Choose a team…</option>
                  {g61Teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>

              {loadingG61Members && <p className="rp-section-sub">Loading roster…</p>}

              {g61Members !== null && (
                <div style={{ marginTop: 12 }}>
                  <label className="rp-label" htmlFor="g61-import-team-name">
                    Team name in gridrep
                  </label>
                  <input
                    id="g61-import-team-name"
                    className="rp-input"
                    value={importTeamName}
                    onChange={(e) => setImportTeamName(e.target.value)}
                    style={{ minWidth: 240, marginTop: 4 }}
                  />

                  <p className="rp-section-sub" style={{ marginTop: 12, marginBottom: 4 }}>
                    Drivers to import ({selectedCustIds.size} selected)
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 220, overflowY: "auto" }}>
                    {g61Members.map((m) => (
                      <label
                        key={m.custId ?? m.name}
                        className="rp-row"
                        style={{ gap: 8, opacity: m.custId ? 1 : 0.5 }}
                      >
                        <input
                          type="checkbox"
                          checked={m.custId ? selectedCustIds.has(m.custId) : false}
                          disabled={!m.custId}
                          onChange={() => m.custId && toggleG61Member(m.custId)}
                        />
                        {m.name}
                        {!m.custId && " (no linked iRacing account)"}
                      </label>
                    ))}
                  </div>

                  <button
                    className="rp-btn rp-primary"
                    style={{ marginTop: 12 }}
                    onClick={importSelectedTeam}
                    disabled={!importTeamName.trim() || importing}
                  >
                    {importing ? "Importing…" : `Import team with ${selectedCustIds.size} driver${selectedCustIds.size === 1 ? "" : "s"}`}
                  </button>
                </div>
              )}
            </div>
          )}
          {importError && <p className="rp-error">{importError}</p>}
        </div>
      )}
    </div>
  );
}
