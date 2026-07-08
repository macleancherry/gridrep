import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

type League = {
  leagueId: string;
  name: string;
  lastSyncedAt: string | null;
  hostCustId: string | null;
  sessionNameFilter: string | null;
};

type SyncSummary = {
  leaguesChecked: number;
  sessionsFound: number;
  sessionsIngested: number;
  cappedAt: number | null;
  failures: Array<{ leagueId: string; subsessionId?: string; message: string }>;
};

export default function PaceHome() {
  const navigate = useNavigate();

  const [subsessionInput, setSubsessionInput] = useState("");
  const [pulling, setPulling] = useState(false);
  const [pullError, setPullError] = useState<string | null>(null);

  const [leagues, setLeagues] = useState<League[]>([]);
  const [leagueInput, setLeagueInput] = useState("");
  const [hostCustIdInput, setHostCustIdInput] = useState("");
  const [sessionNameInput, setSessionNameInput] = useState("");
  const [leagueError, setLeagueError] = useState<string | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [syncSummary, setSyncSummary] = useState<SyncSummary | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  async function loadLeagues() {
    const r = await fetch("/api/pace/leagues");
    const data = await r.json().catch(() => ({ leagues: [] }));
    setLeagues(data.leagues ?? []);
  }

  useEffect(() => {
    loadLeagues();
  }, []);

  async function pullSubsession() {
    const id = subsessionInput.trim();
    if (!id) return;

    setPulling(true);
    setPullError(null);

    try {
      const r = await fetch(`/api/pace/subsessions/${encodeURIComponent(id)}/sync`, { method: "POST" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setPullError(data.message ?? "Sync failed.");
        return;
      }

      const issues: string[] = [];
      if (data.lapsIngested === 0) {
        issues.push(
          `0 laps ingested (${data.simSessionsIngested} sim-session(s), ${data.driversIngested} driver(s) found).`
        );
      }
      const driverFailures: Array<{ custId: string; simsessionNumber: number; message: string }> =
        data.driverFailures ?? [];
      if (driverFailures.length > 0) {
        issues.push(
          `${driverFailures.length} driver lap fetch failure(s): ${driverFailures
            .map((f) => `cust ${f.custId} sim#${f.simsessionNumber}: ${f.message}`)
            .join(" | ")}`
        );
      }
      if (data.emptyLapPayloadSample) {
        issues.push(`Sample lap_data payload for a driver with 0 laps: ${data.emptyLapPayloadSample}`);
      }

      if (issues.length > 0) {
        setPullError(issues.join(" "));
        return;
      }

      navigate(`/pace/s/${encodeURIComponent(id)}`);
    } catch {
      setPullError("Network error. Please try again.");
    } finally {
      setPulling(false);
    }
  }

  async function addLeague() {
    const id = leagueInput.trim();
    const hostCustId = hostCustIdInput.trim();
    const sessionNameFilter = sessionNameInput.trim();
    if (!id) return;

    if (!hostCustId && !sessionNameFilter) {
      setLeagueError("Enter a host cust_id and/or a session-name filter — iRacing requires at least one to search.");
      return;
    }

    setLeagueError(null);
    try {
      const r = await fetch("/api/pace/leagues", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ league_id: id, host_cust_id: hostCustId || undefined, session_name_filter: sessionNameFilter || undefined }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setLeagueError(data.message ?? "Could not add league.");
        return;
      }
      setLeagueInput("");
      setHostCustIdInput("");
      setSessionNameInput("");
      await loadLeagues();
    } catch {
      setLeagueError("Network error. Please try again.");
    }
  }

  async function removeLeague(leagueId: string) {
    await fetch(`/api/pace/leagues/${encodeURIComponent(leagueId)}`, { method: "DELETE" });
    await loadLeagues();
  }

  async function runSync() {
    setSyncing(true);
    setSyncError(null);
    setSyncSummary(null);

    try {
      const r = await fetch("/api/pace/sync", { method: "POST" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setSyncError(data.message ?? "Sync failed.");
        return;
      }
      setSyncSummary(data);
      await loadLeagues();
    } catch {
      setSyncError("Network error. Please try again.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      <p className="pace-hint">Clean-pace calculation for iRacing league sessions, built on GridRep.</p>

      <section className="pace-section">
        <h2>Pull a session</h2>
        <p className="pace-hint">Paste a subsession ID to pull qualifying and race lap data.</p>
        <div className="pace-row">
          <input
            className="pace-input"
            placeholder="Subsession ID"
            value={subsessionInput}
            onChange={(e) => setSubsessionInput(e.target.value)}
          />
          <button className="pace-btn" onClick={pullSubsession} disabled={pulling || !subsessionInput.trim()}>
            {pulling ? "Pulling…" : "Pull"}
          </button>
        </div>
        {pullError && <p className="pace-error">{pullError}</p>}
      </section>

      <section className="pace-section">
        <h2>Followed leagues</h2>
        <p className="pace-hint">
          iRacing requires a host cust_id and/or a session-name filter to search a league's hosted sessions — enter
          at least one.
        </p>
        <div className="pace-row" style={{ marginBottom: 8 }}>
          <input
            className="pace-input"
            placeholder="League ID"
            value={leagueInput}
            onChange={(e) => setLeagueInput(e.target.value)}
          />
          <input
            className="pace-input"
            placeholder="Host cust_id (optional)"
            value={hostCustIdInput}
            onChange={(e) => setHostCustIdInput(e.target.value)}
          />
          <input
            className="pace-input"
            placeholder="Session name filter (optional)"
            value={sessionNameInput}
            onChange={(e) => setSessionNameInput(e.target.value)}
          />
        </div>
        <div className="pace-row" style={{ marginBottom: 12 }}>
          <button className="pace-btn-ghost pace-btn" onClick={addLeague} disabled={!leagueInput.trim()}>
            Follow
          </button>
          <button className="pace-btn" onClick={runSync} disabled={syncing || leagues.length === 0}>
            {syncing ? "Syncing…" : "Sync now"}
          </button>
        </div>
        {leagueError && <p className="pace-error">{leagueError}</p>}

        <div className="pace-list">
          {leagues.length === 0 && <div className="pace-list-empty">No leagues followed yet.</div>}
          {leagues.map((l) => (
            <div className="pace-list-item" key={l.leagueId}>
              <span>
                {l.name} <span className="pace-muted pace-mono">#{l.leagueId}</span>
                {(l.hostCustId || l.sessionNameFilter) && (
                  <>
                    {" "}
                    <span className="pace-muted">
                      ({l.hostCustId ? `host ${l.hostCustId}` : ""}
                      {l.hostCustId && l.sessionNameFilter ? ", " : ""}
                      {l.sessionNameFilter ? `name contains "${l.sessionNameFilter}"` : ""})
                    </span>
                  </>
                )}
              </span>
              <span className="pace-row">
                <span className="pace-muted">
                  {l.lastSyncedAt ? `Last synced ${new Date(l.lastSyncedAt).toLocaleString()}` : "Never synced"}
                </span>
                <button className="pace-btn-ghost pace-btn" onClick={() => removeLeague(l.leagueId)}>
                  Unfollow
                </button>
              </span>
            </div>
          ))}
        </div>

        {syncError && <p className="pace-error" style={{ marginTop: 12 }}>{syncError}</p>}
        {syncSummary && (
          <>
            <p className="pace-hint" style={{ marginTop: 12 }}>
              Checked {syncSummary.leaguesChecked} league(s), found {syncSummary.sessionsFound} session(s), ingested{" "}
              {syncSummary.sessionsIngested}.
              {syncSummary.cappedAt ? " Hit the per-run cap — click Sync again to continue." : ""}
              {syncSummary.failures.length > 0 ? ` ${syncSummary.failures.length} failure(s).` : ""}
            </p>
            {syncSummary.failures.length > 0 && (
              <ul className="pace-hint" style={{ marginTop: 4 }}>
                {syncSummary.failures.map((f, i) => (
                  <li key={i}>
                    {f.subsessionId ? `Subsession ${f.subsessionId}` : `League ${f.leagueId}`}: {f.message}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </>
  );
}
