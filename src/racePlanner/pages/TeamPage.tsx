import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useDriverSearch } from "../useDriverSearch";
import { useRacePlannerViewer } from "../useRacePlannerViewer";

type Garage61TeamSummary = { id: string; name: string };

type RosterMember = {
  custId: string;
  driverName: string | null;
  role: "coordinator" | "driver";
  status: "invited" | "active";
  invitedAt: string;
  joinedAt: string | null;
};

type TeamDetail = {
  team: { id: string; name: string };
  roster: RosterMember[];
  isCoordinator: boolean;
  inviteToken: string | null;
};

export default function TeamPage() {
  const { teamId } = useParams<{ teamId: string }>();
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
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<string | null>(null);

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
        body: JSON.stringify({ g61TeamId: selectedG61TeamId }),
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
      <h2>{detail.team.name}</h2>

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
            <div className="rp-row" style={{ flexWrap: "wrap" }}>
              <select className="rp-input" value={selectedG61TeamId} onChange={(e) => setSelectedG61TeamId(e.target.value)}>
                <option value="">Choose a team…</option>
                {g61Teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button className="rp-btn rp-primary" onClick={importFromG61} disabled={!selectedG61TeamId || importing}>
                {importing ? "Importing…" : "Import"}
              </button>
            </div>
          )}
          {importSummary && <p className="rp-section-sub" style={{ color: "var(--rp-green)" }}>{importSummary}</p>}
          {importError && <p className="rp-error">{importError}</p>}
        </div>
      )}

      <h3>Roster</h3>
      <div className="rp-event-grid">
        {detail.roster.map((m) => (
          <div className="rp-event-card" key={m.custId}>
            <h3 className="rp-event-track">{m.driverName ?? `Driver ${m.custId}`}</h3>
            <div className="rp-row" style={{ gap: 6 }}>
              {m.role === "coordinator" && <span className="rp-badge rp-dim">Coordinator</span>}
              <span className={`rp-badge ${m.status === "active" ? "rp-green" : "rp-amber"}`}>
                {m.status === "active" ? "Active" : "Invited — not joined yet"}
              </span>
            </div>
          </div>
        ))}
        {detail.roster.length === 0 && <p className="rp-section-sub">No one on this roster yet.</p>}
      </div>
    </div>
  );
}
