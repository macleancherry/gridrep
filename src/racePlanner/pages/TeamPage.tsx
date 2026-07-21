import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useDriverSearch } from "../useDriverSearch";
import { useRacePlannerViewer } from "../useRacePlannerViewer";

type Garage61TeamSummary = { id: string; name: string };
type Garage61Member = { custId: string | null; name: string };

type RosterMember = {
  custId: string;
  userId: string | null;
  driverName: string | null;
  role: "coordinator" | "driver";
  status: "invited" | "active";
  invitedAt: string;
  joinedAt: string | null;
};

type TeamWeekend = {
  weekendId: string;
  name: string | null;
  eventId: string;
  trackName: string | null;
  scheduledStartTime: string | null;
  planId: string | null;
  carCount: number;
  viewerHasSubmittedAvailability: boolean;
};

type TeamDetail = {
  team: { id: string; name: string; createdBy: string };
  roster: RosterMember[];
  isCoordinator: boolean;
  inviteToken: string | null;
  weekends: TeamWeekend[];
};

export default function TeamPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const navigate = useNavigate();
  const viewer = useRacePlannerViewer();
  const [detail, setDetail] = useState<TeamDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const [copied, setCopied] = useState(false);
  const { results: searchResults, livePending } = useDriverSearch(query);

  const [showG61Picker, setShowG61Picker] = useState(false);
  const [g61Teams, setG61Teams] = useState<Garage61TeamSummary[] | null>(null);
  const [selectedG61TeamId, setSelectedG61TeamId] = useState("");
  const [g61Members, setG61Members] = useState<Garage61Member[] | null>(null);
  const [loadingG61Members, setLoadingG61Members] = useState(false);
  const [selectedCustIds, setSelectedCustIds] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<string | null>(null);

  const [removingCustId, setRemovingCustId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deletingTeam, setDeletingTeam] = useState(false);
  const [deleteTeamError, setDeleteTeamError] = useState<string | null>(null);

  function load() {
    if (!teamId) return;
    setLoading(true);
    fetch(`/api/planner/teams/${encodeURIComponent(teamId)}`, { credentials: "include" })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok || !data.ok) {
          setError(data.message ?? "Could not load this team.");
          return;
        }
        setDetail(data);
      })
      .catch(() => setError("Network error. Please try again."))
      .finally(() => setLoading(false));
  }

  useEffect(load, [teamId]);

  async function addDriver(custId: string, name: string) {
    if (!teamId) return;
    setAdding(true);
    try {
      const r = await fetch(`/api/planner/teams/${encodeURIComponent(teamId)}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ custId, name }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.ok) {
        setQuery("");
        load();
      }
    } finally {
      setAdding(false);
    }
  }

  async function regenerateInvite() {
    if (!teamId) return;
    setGeneratingInvite(true);
    try {
      const r = await fetch(`/api/planner/teams/${encodeURIComponent(teamId)}/invite`, {
        method: "POST",
        credentials: "include",
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.ok) load();
    } finally {
      setGeneratingInvite(false);
    }
  }

  function openG61Picker() {
    setShowG61Picker(true);
    setImportError(null);
    setImportSummary(null);
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

  // Loads that Garage 61 team's members so the coordinator can choose exactly who comes
  // onto this team's roster - never silently imported in bulk. All custId-having members
  // start checked (still zero extra clicks for "import everyone"), but every one is
  // visible and can be unchecked before anything is added.
  async function selectG61Team(g61TeamId: string) {
    setSelectedG61TeamId(g61TeamId);
    setG61Members(null);
    setSelectedCustIds(new Set());
    setImportError(null);
    setImportSummary(null);
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

  async function importFromG61() {
    if (!teamId || !selectedG61TeamId) return;
    setImporting(true);
    setImportError(null);
    setImportSummary(null);
    try {
      const r = await fetch(`/api/planner/teams/${encodeURIComponent(teamId)}/import-garage61`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ g61TeamId: selectedG61TeamId, custIds: [...selectedCustIds] }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setImportError(data.message ?? "Could not import that team's roster.");
        return;
      }
      const parts = [`${data.imported} driver${data.imported === 1 ? "" : "s"} added`];
      if (data.alreadyOnRoster) parts.push(`${data.alreadyOnRoster} already on the roster`);
      if (data.skippedNoIracingAccount) parts.push(`${data.skippedNoIracingAccount} have no linked iRacing account in Garage 61`);
      setImportSummary(`Imported from ${data.teamName} — ${parts.join(", ")}.`);
      load();
    } catch {
      setImportError("Network error. Please try again.");
    } finally {
      setImporting(false);
    }
  }

  async function removeMember(custId: string, name: string) {
    if (!teamId) return;
    if (!window.confirm(`Remove ${name} from this team's roster? They'll keep any race plan they're already in — this just takes them off the team.`)) {
      return;
    }
    setRemovingCustId(custId);
    setRemoveError(null);
    try {
      const r = await fetch(`/api/planner/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(custId)}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setRemoveError(data.message ?? "Could not remove that driver.");
        return;
      }
      load();
    } catch {
      setRemoveError("Network error. Please try again.");
    } finally {
      setRemovingCustId(null);
    }
  }

  const deleteTeamConfirmed = detail !== null && deleteConfirmText === detail.team.name;

  async function deleteTeam() {
    if (!teamId || !deleteTeamConfirmed) return;
    setDeletingTeam(true);
    setDeleteTeamError(null);
    try {
      const r = await fetch(`/api/planner/teams/${encodeURIComponent(teamId)}`, { method: "DELETE", credentials: "include" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setDeleteTeamError(data.message ?? "Could not delete this team. Please try again.");
        return;
      }
      navigate("/race-planner/team");
    } catch {
      setDeleteTeamError("Network error. Please try again.");
    } finally {
      setDeletingTeam(false);
    }
  }

  const inviteUrl = detail?.inviteToken ? `${window.location.origin}/race-planner/join/${detail.inviteToken}` : null;

  function copyInvite() {
    if (!inviteUrl) return;
    navigator.clipboard?.writeText(inviteUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (loading) return <p className="rp-section-sub">Loading…</p>;
  if (error) return <p className="rp-error">{error}</p>;
  if (!detail) return null;

  const alreadyOnRoster = new Set(detail.roster.map((m) => m.custId));

  return (
    <div>
      <div className="rp-row" style={{ justifyContent: "space-between", flexWrap: "wrap", marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>{detail.team.name}</h2>
        {detail.isCoordinator && (
          <button className="rp-btn rp-primary" onClick={() => navigate(`/race-planner/series?teamId=${encodeURIComponent(teamId!)}`)}>
            Plan a race for this team →
          </button>
        )}
      </div>

      <div className="rp-card rp-card-narrow" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Upcoming race weekends</h3>
        {detail.weekends.length === 0 ? (
          <p className="rp-section-sub">
            Nothing planned yet.{" "}
            {detail.isCoordinator ? "Use \"Plan a race for this team\" above to get started." : "Check back once your coordinator plans one."}
          </p>
        ) : (
          <div className="rp-profile-list">
            {detail.weekends.map((w) => (
              <div className="rp-row" key={w.weekendId} style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div className="rp-profile-label">{w.name}</div>
                  <div className="rp-text-faint" style={{ fontSize: 11, marginTop: 2 }}>
                    {w.trackName ?? "Track TBD"}
                    {w.scheduledStartTime ? ` · ${new Date(w.scheduledStartTime).toLocaleString()}` : ""}
                    {w.carCount > 1 ? ` · ${w.carCount} cars` : ""}
                  </div>
                </div>
                <Link
                  className={`rp-btn ${w.viewerHasSubmittedAvailability ? "" : "rp-primary"}`}
                  to={
                    w.carCount > 1
                      ? `/race-planner/weekend/${w.weekendId}`
                      : w.planId
                        ? `/race-planner/availability/${w.planId}`
                        : `/race-planner/weekend/${w.weekendId}`
                  }
                >
                  {w.carCount > 1
                    ? "Manage this weekend →"
                    : w.viewerHasSubmittedAvailability
                      ? "✓ Availability set — adjust →"
                      : "Set your availability →"}
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {detail.isCoordinator && (
        <div className="rp-card rp-card-narrow" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Invite drivers</h3>
          <p className="rp-section-sub">Share this link — anyone who clicks it can join {detail.team.name}.</p>
          {inviteUrl ? (
            <>
              <div className="rp-invite-link-box">{inviteUrl}</div>
              <div className="rp-share-actions">
                <button className="rp-btn" onClick={copyInvite}>
                  {copied ? "Copied!" : "Copy link"}
                </button>
                <a className="rp-btn" href={`mailto:?subject=${encodeURIComponent(`Join ${detail.team.name} on gridrep`)}&body=${encodeURIComponent(inviteUrl)}`}>
                  Email →
                </a>
                <a
                  className="rp-btn"
                  href={`https://wa.me/?text=${encodeURIComponent(`Join ${detail.team.name} on gridrep: ${inviteUrl}`)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  WhatsApp →
                </a>
              </div>
            </>
          ) : (
            <button className="rp-btn rp-primary" onClick={regenerateInvite} disabled={generatingInvite}>
              {generatingInvite ? "Generating…" : "Generate invite link"}
            </button>
          )}
          {inviteUrl && (
            <button className="rp-btn" style={{ marginTop: 8 }} onClick={regenerateInvite} disabled={generatingInvite}>
              {generatingInvite ? "Regenerating…" : "Regenerate link (deactivates the old one)"}
            </button>
          )}
        </div>
      )}

      {detail.isCoordinator && (
        <div className="rp-card rp-card-narrow" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Add a driver directly</h3>
          <input
            className="rp-input"
            placeholder="Search by name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ minWidth: 240 }}
          />
          {livePending && <p className="rp-text-faint" style={{ fontSize: 12, marginTop: 4 }}>🔎 Checking iRacing for more matches…</p>}
          {query.trim() && searchResults.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, marginTop: 8 }}>
              {searchResults.map((d) => (
                <li key={d.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" }}>
                  <span>{d.name}</span>
                  <button
                    className="rp-btn"
                    disabled={adding || alreadyOnRoster.has(d.id)}
                    onClick={() => addDriver(d.id, d.name)}
                  >
                    {alreadyOnRoster.has(d.id) ? "Already on roster" : "Add"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {detail.isCoordinator && viewer.verified && viewer.garage61Connected && (
        <div className="rp-card rp-card-narrow" style={{ marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Import roster from Garage 61</h3>
          <p className="rp-section-sub">
            Pull in members from a Garage 61 team you belong to — only adds drivers not already on this roster, safe
            to run again after their Garage 61 team changes.
          </p>
          {!showG61Picker ? (
            <button className="rp-btn" onClick={openG61Picker}>
              Choose a Garage 61 team
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
                  <p className="rp-section-sub" style={{ marginBottom: 4 }}>
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
                    onClick={importFromG61}
                    disabled={importing}
                  >
                    {importing ? "Importing…" : `Import ${selectedCustIds.size} driver${selectedCustIds.size === 1 ? "" : "s"}`}
                  </button>
                </div>
              )}
            </div>
          )}
          {importSummary && <p className="rp-section-sub" style={{ color: "var(--rp-green)" }}>{importSummary}</p>}
          {importError && <p className="rp-error">{importError}</p>}
        </div>
      )}

      <h3>Roster</h3>
      {removeError && <p className="rp-error">{removeError}</p>}
      <div className="rp-event-grid">
        {detail.roster.map((m) => {
          const isCreator = m.userId !== null && m.userId === detail.team.createdBy;
          return (
            <div className="rp-event-card" key={m.custId}>
              <h3 className="rp-event-track">{m.driverName ?? `Driver ${m.custId}`}</h3>
              <div className="rp-row" style={{ gap: 6 }}>
                {m.role === "coordinator" && <span className="rp-badge rp-dim">Coordinator</span>}
                <span className={`rp-badge ${m.status === "active" ? "rp-green" : "rp-amber"}`}>
                  {m.status === "active" ? "Active" : "Invited — not joined yet"}
                </span>
              </div>
              {detail.isCoordinator && !isCreator && (
                <button
                  className="rp-btn"
                  style={{ marginTop: 8, alignSelf: "flex-start" }}
                  onClick={() => removeMember(m.custId, m.driverName ?? `Driver ${m.custId}`)}
                  disabled={removingCustId === m.custId}
                >
                  {removingCustId === m.custId ? "Removing…" : "Remove from team"}
                </button>
              )}
            </div>
          );
        })}
        {detail.roster.length === 0 && <p className="rp-section-sub">No one on this roster yet.</p>}
      </div>

      {detail.isCoordinator && (
        <div className="rp-card" style={{ marginTop: 24, borderColor: "var(--rp-red)" }}>
          <h3 style={{ marginTop: 0, color: "var(--rp-red)" }}>Danger zone</h3>
          <p className="rp-section-sub">
            Permanently deletes this team: its whole roster, invite link, and every race weekend it owns — including
            each weekend's cars, lineups, stints, and everyone's submitted availability for them.{" "}
            <strong>This can't be undone.</strong>
          </p>
          {deleteTeamError && <p className="rp-error">{deleteTeamError}</p>}
          <div className="rp-form-field" style={{ marginBottom: 10, maxWidth: 320 }}>
            <label>
              Type the team's name (<strong>{detail.team.name}</strong>) to confirm
            </label>
            <input
              className="rp-input"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              disabled={deletingTeam}
              placeholder={detail.team.name}
            />
          </div>
          <button
            className="rp-btn"
            style={{ borderColor: "var(--rp-red)", color: "var(--rp-red)" }}
            onClick={deleteTeam}
            disabled={!deleteTeamConfirmed || deletingTeam}
          >
            {deletingTeam ? "Deleting…" : "Delete this team permanently"}
          </button>
        </div>
      )}
    </div>
  );
}
