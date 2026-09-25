import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { usePaceBrand, usePaceEmbed, withBrand, withEmbed } from "../brands";

type LeagueRace = {
  subsessionId: string;
  trackName: string | null;
  seriesName: string | null;
  startTime: string | null;
};

function LeagueRaceList({ leagueId, brandKey }: { leagueId: string; brandKey: string | null }) {
  const embed = usePaceEmbed();
  const [races, setRaces] = useState<LeagueRace[] | null>(null);
  const [leagueName, setLeagueName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const r = await fetch(`/api/pace/leagues/${encodeURIComponent(leagueId)}`);
        const data = await r.json().catch(() => ({}));
        if (cancelled) return;
        if (r.status === 404) {
          // Not an end-user-facing problem - it means this league hasn't
          // been followed from the admin (unbranded) /pace page yet, not
          // that anything is actually broken. Don't surface backend wording.
          setError("Races aren't set up here yet — check back soon.");
          return;
        }
        if (!r.ok || !data.ok) {
          setError(data.message ?? "Could not load races.");
          return;
        }
        setLeagueName(data.league?.name ?? null);
        setRaces(data.races ?? []);
      } catch {
        if (!cancelled) setError("Network error.");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

  return (
    <section className="pace-section">
      <h2>{leagueName ?? "Races"}</h2>
      <p className="pace-hint">Pick a race to see clean pace, positions and incidents.</p>
      {error && <p className="pace-error">{error}</p>}
      {!races && !error && <p className="pace-hint">Loading…</p>}
      {races && (
        <div className="pace-list">
          {races.length === 0 && <div className="pace-list-empty">No races synced yet — check back after the next race weekend.</div>}
          {races.map((race) => (
            <Link
              key={race.subsessionId}
              to={withEmbed(withBrand(`/pace/s/${race.subsessionId}`, brandKey), embed)}
              className="pace-list-item"
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <span>
                {race.seriesName ?? race.trackName ?? `Subsession #${race.subsessionId}`}
                {race.trackName && race.seriesName && <span className="pace-muted"> — {race.trackName}</span>}
              </span>
              <span className="pace-muted">
                {race.startTime ? new Date(race.startTime).toLocaleDateString(undefined, { dateStyle: "medium" }) : ""}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

type IngestResponse = {
  ok: boolean;
  message?: string;
  lapsIngested?: number;
  simSessionsIngested?: number;
  driversIngested?: number;
  totalJobs?: number;
  remainingJobs?: number;
  emptyLapPayloadSample?: string;
  driverFailures?: Array<{ custId: string; simsessionNumber: number; message: string }>;
};

type League = {
  leagueId: string;
  name: string;
  lastSyncedAt: string | null;
  hostCustId: string | null;
  sessionNameFilter: string | null;
};

type SyncResponse = {
  ok: boolean;
  message?: string;
  leaguesChecked: number;
  sessionsFound: number;
  sessionsIngested: number;
  sessionsAttached: number;
  sessionsRemaining: number;
  failures: Array<{ leagueId: string; subsessionId?: string; message: string }>;
  emptySearchSamples: Array<{ leagueId: string; sample: string }>;
};

type SyncSummary = {
  sessionsFound: number;
  sessionsIngested: number;
  sessionsAttached: number;
  failures: Array<{ leagueId: string; subsessionId?: string; message: string }>;
  emptySearchSamples: Array<{ leagueId: string; sample: string }>;
};

export default function PaceHome() {
  const navigate = useNavigate();
  const { brand, brandKey } = usePaceBrand();
  const embed = usePaceEmbed();

  const [subsessionInput, setSubsessionInput] = useState("");
  const [pulling, setPulling] = useState(false);
  const [pullError, setPullError] = useState<string | null>(null);
  const [pullProgress, setPullProgress] = useState<string | null>(null);

  const [leagues, setLeagues] = useState<League[]>([]);
  const [leagueInput, setLeagueInput] = useState("");
  const [hostCustIdInput, setHostCustIdInput] = useState("");
  const [sessionNameInput, setSessionNameInput] = useState("");
  const [leagueError, setLeagueError] = useState<string | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<string | null>(null);
  const [syncSummary, setSyncSummary] = useState<SyncSummary | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  async function loadLeagues() {
    const r = await fetch("/api/pace/leagues");
    const data = await r.json().catch(() => ({ leagues: [] }));
    setLeagues(data.leagues ?? []);
  }

  useEffect(() => {
    // The admin "followed leagues" list isn't shown (or needed) on a
    // branded single-league view - skip fetching it for that public visitor.
    if (!brand?.leagueId) loadLeagues();
  }, [brand?.leagueId]);

  async function pullSubsession() {
    const id = subsessionInput.trim();
    if (!id) return;

    setPulling(true);
    setPullError(null);
    setPullProgress(null);

    // A large field can need far more lap_data calls than Cloudflare Workers
    // allows as subrequests in one invocation, so ingestion is resumable:
    // each call does a bounded batch and reports how many pairs are still
    // pending. Keep calling until nothing's left, or bail after a sane cap.
    const MAX_BATCHES = 30;
    const allDriverFailures: Array<{ custId: string; simsessionNumber: number; message: string }> = [];
    let totalLapsIngested = 0;
    let lastData: IngestResponse | null = null;

    try {
      for (let batch = 0; batch < MAX_BATCHES; batch++) {
        const r = await fetch(`/api/pace/subsessions/${encodeURIComponent(id)}/sync`, { method: "POST" });
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data.ok) {
          setPullError(data.message ?? "Sync failed.");
          return;
        }

        lastData = data;
        totalLapsIngested += data.lapsIngested ?? 0;
        allDriverFailures.push(...(data.driverFailures ?? []));

        const remaining = data.remainingJobs ?? 0;
        if (remaining === 0) break;

        setPullProgress(
          `Ingesting laps… ${totalLapsIngested} lap(s) so far, ${remaining} of ${data.totalJobs} driver/sim-session pull(s) left.`
        );
      }

      setPullProgress(null);

      // A single driver legitimately having 0 laps in a sim-session (no-showed
      // qualifying, DNF before a timed lap, etc.) is normal and shouldn't block
      // viewing results for everyone else - only treat it as a real problem
      // when NOTHING came through at all, or the run didn't finish.
      const issues: string[] = [];
      if (totalLapsIngested === 0) {
        issues.push(
          `0 laps ingested (${lastData?.simSessionsIngested} sim-session(s), ${lastData?.driversIngested} driver(s) found).`
        );
        if (lastData?.emptyLapPayloadSample) {
          issues.push(`Sample lap_data payload: ${lastData.emptyLapPayloadSample}`);
        }
      }
      if (lastData?.remainingJobs && lastData.remainingJobs > 0) {
        issues.push(
          `Stopped after ${MAX_BATCHES} batches with ${lastData.remainingJobs} pull(s) still pending — click Pull again to continue.`
        );
      }

      if (allDriverFailures.length > 0) {
        console.warn("pace pull: some driver lap fetches failed", allDriverFailures);
      }

      if (issues.length > 0) {
        setPullError(issues.join(" "));
        return;
      }

      navigate(withEmbed(withBrand(`/pace/s/${encodeURIComponent(id)}`, brandKey), embed));
    } catch {
      setPullError("Network error. Please try again.");
    } finally {
      setPulling(false);
      setPullProgress(null);
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
    setLeagueError(null);
    try {
      const r = await fetch(`/api/pace/leagues/${encodeURIComponent(leagueId)}`, { method: "DELETE" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setLeagueError(data.message ?? "Could not unfollow this league.");
        return;
      }
      await loadLeagues();
    } catch {
      setLeagueError("Network error. Please try again.");
    }
  }

  async function runSync() {
    setSyncing(true);
    setSyncError(null);
    setSyncSummary(null);
    setSyncProgress(null);

    // A followed league can have a large backlog of hosted sessions, and
    // each one can itself need several calls to fully ingest (large field) -
    // /api/pace/sync only attempts one subsession per call for the same
    // subrequest-budget reason the Pull flow batches, so loop it here too
    // until nothing's left, showing live progress along the way.
    const MAX_ITERATIONS = 500;
    const summary: SyncSummary = { sessionsFound: 0, sessionsIngested: 0, sessionsAttached: 0, failures: [], emptySearchSamples: [] };

    try {
      for (let i = 0; i < MAX_ITERATIONS; i++) {
        const r = await fetch("/api/pace/sync", { method: "POST" });
        const data: SyncResponse = await r.json().catch(() => ({}) as SyncResponse);
        if (!r.ok || !data.ok) {
          setSyncError(data.message ?? "Sync failed.");
          return;
        }

        summary.sessionsFound = Math.max(summary.sessionsFound, data.sessionsFound ?? 0);
        summary.sessionsIngested += data.sessionsIngested ?? 0;
        summary.sessionsAttached += data.sessionsAttached ?? 0;
        summary.failures.push(...(data.failures ?? []));
        summary.emptySearchSamples.push(...(data.emptySearchSamples ?? []));

        const remaining = data.sessionsRemaining ?? 0;
        if (remaining === 0) break;

        setSyncProgress(`Syncing… ${summary.sessionsIngested} of ${summary.sessionsFound} session(s) ingested, ${remaining} left.`);
        await loadLeagues();
      }

      setSyncSummary(summary);
      await loadLeagues();
    } catch {
      setSyncError("Network error. Please try again.");
    } finally {
      setSyncing(false);
      setSyncProgress(null);
    }
  }

  if (brand?.leagueId) {
    return <LeagueRaceList leagueId={brand.leagueId} brandKey={brandKey} />;
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
        {pullProgress && <p className="pace-hint">{pullProgress}</p>}
        {pullError && <p className="pace-error">{pullError}</p>}
      </section>

      <section className="pace-section">
        <h2>Followed leagues</h2>
        <p className="pace-hint">
          iRacing requires a host cust_id and/or a session-name filter to search a league's hosted sessions — enter
          at least one. If the league rotates who hosts each round, enter several cust_ids separated by commas —
          otherwise sessions hosted by anyone else silently never get found.
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
            placeholder="Host cust_id(s), comma-separated (optional)"
            value={hostCustIdInput}
            onChange={(e) => setHostCustIdInput(e.target.value)}
          />
          <input
            className="pace-input"
            placeholder="Session name filter(s), comma-separated (optional)"
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

        {syncProgress && <p className="pace-hint" style={{ marginTop: 12 }}>{syncProgress}</p>}
        {syncError && <p className="pace-error" style={{ marginTop: 12 }}>{syncError}</p>}
        {syncSummary && (
          <>
            <p className="pace-hint" style={{ marginTop: 12 }}>
              Found {syncSummary.sessionsFound} session(s), ingested {syncSummary.sessionsIngested}.
              {syncSummary.sessionsAttached > 0
                ? ` ${syncSummary.sessionsAttached} already-pulled session(s) linked to this league.`
                : ""}
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
            {syncSummary.emptySearchSamples?.length > 0 && (
              <ul className="pace-hint" style={{ marginTop: 4 }}>
                {syncSummary.emptySearchSamples.map((s, i) => (
                  <li key={i}>
                    League {s.leagueId} search returned 0 matches — raw response: {s.sample}
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
