import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { PROP_REASONS } from "../lib/propReasons";

type DriverHit = { id: string; name: string; propsReceived?: number };

type ViewerState =
  | { loading: true; verified: false; user?: undefined }
  | { loading: false; verified: false; user?: undefined }
  | { loading: false; verified: true; user: { id: string; iracingId: string; name: string } };

type LeaderboardRow = { id: string; name: string; propsReceived: number };

type FeedRow = {
  createdAt: string;
  reason: string;
  sessionId: string;
  seriesName?: string;
  trackName?: string;
  fromDriverId?: string;
  fromName?: string;
  toDriverId: string;
  toName?: string;
};

const LEGACY_REASON_LABELS: Record<string, string> = {
  respectful_driving: "Respectful driving",
  great_racecraft: "Great racecraft",
  good_etiquette: "Good etiquette",
  helpful_friendly: "Helpful / friendly",
  other: "Other",
};

async function fetchViewer(): Promise<ViewerState> {
  try {
    const r = await fetch("/api/viewer");
    const json = await r.json().catch(() => ({ verified: false }));
    if (json?.verified && json?.user) return { loading: false, verified: true, user: json.user };
    return { loading: false, verified: false };
  } catch {
    return { loading: false, verified: false };
  }
}

export default function Home() {
  const location = useLocation();

  // Search state
  const [q, setQ] = useState("");
  const [results, setResults] = useState<DriverHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Viewer + sync
  const [viewer, setViewer] = useState<ViewerState>({ loading: true, verified: false });
  const [syncMsg, setSyncMsg] = useState<string>("");
  const [syncBusy, setSyncBusy] = useState(false);
  const [lastSync, setLastSync] = useState<{ ok: boolean; sessionsImported?: number } | null>(null);
  const [autoSyncStarted, setAutoSyncStarted] = useState(false);

  // Leaderboard + feed
  const [lbWindow, setLbWindow] = useState<"7d" | "30d" | "all">("7d");
  const [lbBusy, setLbBusy] = useState(true);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);

  const [feedBusy, setFeedBusy] = useState(true);
  const [feed, setFeed] = useState<FeedRow[]>([]);

  const reasonLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of PROP_REASONS) map.set(r.id, r.label);
    for (const [k, v] of Object.entries(LEGACY_REASON_LABELS)) map.set(k, v);
    return map;
  }, []);

  function displayReason(reason: string | undefined | null): string {
    const r = (reason ?? "").trim();
    if (!r) return "Props";
    return reasonLabelById.get(r) ?? r;
  }

  function verifyUrl() {
    // Preserve querystring too (helps if you ever add deep links)
    return `/api/auth/start?returnTo=${encodeURIComponent(location.pathname + location.search)}`;
  }

  async function search() {
    const query = q.trim();
    if (!query) return;
    setHasSearched(true);
    setLoading(true);
    try {
      const r = await fetch(`/api/drivers/search?q=${encodeURIComponent(query)}`);
      const j = await r.json();
      setResults(j.results || []);
    } finally {
      setLoading(false);
    }
  }

  async function loadLeaderboard(window: "7d" | "30d" | "all") {
    setLbBusy(true);
    try {
      const r = await fetch(`/api/leaderboard?window=${window}`);
      const j = await r.json().catch(() => ({ results: [] }));
      setLeaderboard(j.results ?? []);
    } finally {
      setLbBusy(false);
    }
  }

  async function loadFeed() {
    setFeedBusy(true);
    try {
      const r = await fetch(`/api/feed`);
      const j = await r.json().catch(() => ({ results: [] }));
      setFeed(j.results ?? []);
    } finally {
      setFeedBusy(false);
    }
  }

  async function syncRecent(opts?: { startMessage?: string }) {
    if (syncBusy) return;

    if (!viewer.verified) {
      window.location.href = verifyUrl();
      return;
    }

    setLastSync(null);
    setSyncBusy(true);
    setSyncMsg(
      opts?.startMessage ??
        "Syncing your recent races… this can take up to a minute. You can keep browsing while we work."
    );

    try {
      const r = await fetch("/api/iracing/recent/import", { method: "POST" });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        const reason = (t || `${r.status} ${r.statusText}` || `Sync failed (${r.status}).`).trim();
        setLastSync({ ok: false });
        setSyncMsg(`Sync failed: ${reason}. Please try again.`);
        return;
      }

      const j = await r.json().catch(() => ({}));
      const imported = Number(j?.sessionsImported ?? 0) || 0;

      setLastSync({ ok: true, sessionsImported: imported });
      setSyncMsg(`Synced ${imported} sessions. Next: search your own name below to find your driver profile.`);

      await Promise.all([loadLeaderboard(lbWindow), loadFeed()]);
    } catch {
      setLastSync({ ok: false });
      setSyncMsg("Sync failed — network error. Please try again.");
    } finally {
      setSyncBusy(false);
    }
  }

  useEffect(() => {
    (async () => setViewer(await fetchViewer()))();
  }, []);

  // Auto-sync once after returning from OAuth when verified=1 is present
  useEffect(() => {
    if (autoSyncStarted) return;
    if (viewer.loading) return;
    if (!viewer.verified) return;

    const params = new URLSearchParams(location.search);
    const justVerified = params.get("verified") === "1";
    if (!justVerified) return;

    setAutoSyncStarted(true);

    // Remove only the verified param to avoid re-triggering on refresh/back
    params.delete("verified");
    const nextQs = params.toString();
    const nextUrl = nextQs ? `${location.pathname}?${nextQs}` : location.pathname;
    window.history.replaceState({}, "", nextUrl);

    void syncRecent({
      startMessage: "Syncing your recent races… this can take up to a minute. You can keep browsing while we work.",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSyncStarted, viewer.loading, viewer.verified, location.pathname, location.search]);

  useEffect(() => {
    loadLeaderboard(lbWindow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lbWindow]);

  useEffect(() => {
    loadFeed();
  }, []);

  const showIntroEmpty = !hasSearched && results.length === 0;
  const showNoResults = hasSearched && results.length === 0;

  const canSearchMyName = viewer.verified && !viewer.loading;
  const myName = viewer.verified ? viewer.user.name : "";

  async function searchMyName() {
    if (!canSearchMyName || !myName) return;
    setQ(myName);
    setHasSearched(true);
    setLoading(true);
    try {
      const r = await fetch(`/api/drivers/search?q=${encodeURIComponent(myName)}`);
      const j = await r.json();
      setResults(j.results || []);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="stack">
      {/* Verify / Sync callout */}
      <div className="card card-pad">
        <div className="row space-between wrap" style={{ alignItems: "center" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 900, marginBottom: 4 }}>
              {viewer.loading ? "Checking verification…" : viewer.verified ? "You’re verified" : "Browse mode"}
            </div>
            <div className="subtle">
              You can browse cached drivers/sessions without logging in. Verify to send Props, and sync to populate your
              profile + recent sessions.
            </div>

            {syncMsg && (
              <div className="subtle" style={{ marginTop: 8, whiteSpace: "pre-line" }}>
                {syncMsg}
              </div>
            )}

            {viewer.verified && lastSync?.ok && (
              <div className="row wrap" style={{ gap: 10, marginTop: 10, alignItems: "center" }}>
                <button className="btn btn-primary" type="button" onClick={searchMyName} disabled={loading || !myName}>
                  {loading ? "Searching…" : `Search my name (${myName})`}
                </button>
                <div className="subtle" style={{ minWidth: 0 }}>
                  This is the fastest way to find your driver page after sync.
                </div>
              </div>
            )}

            {viewer.verified && lastSync?.ok === false && (
              <div className="subtle" style={{ marginTop: 10 }}>
                Tip: you can retry sync any time using the button on the right.
              </div>
            )}
          </div>

          <div className="row wrap" style={{ gap: 10 }}>
            {viewer.verified ? (
              <button className="btn btn-primary" type="button" onClick={() => syncRecent()} disabled={syncBusy}>
                {syncBusy ? "Syncing…" : "Sync my recent races"}
              </button>
            ) : (
              <a className="btn btn-primary" href={verifyUrl()} style={{ textDecoration: "none" }}>
                Verify with iRacing →
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Hero + Search */}
      <div className="card hero">
        <div className="row space-between wrap">
          <div style={{ minWidth: 0 }}>
            <h1 className="mt-0" style={{ marginBottom: 6 }}>
              Find a driver
            </h1>
            <div className="subtle">
              Send <strong>Props (GG)</strong> after races. A quick public nod for clean driving.
            </div>
          </div>

          <Link className="btn btn-ghost" to="/about" style={{ textDecoration: "none" }}>
            How it works →
          </Link>
        </div>

        <div className="row search-row" style={{ marginTop: 14 }}>
          <input
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search iRacing driver…"
            onKeyDown={(e) => e.key === "Enter" && search()}
          />

          <button className="btn btn-primary" onClick={search} style={{ width: 140 }}>
            {loading ? "Searching…" : "Search"}
          </button>
        </div>

        {viewer.verified && lastSync?.ok && (
          <div className="hint" style={{ marginTop: 10 }}>
            <span>Just synced?</span>
            <span style={{ color: "var(--muted2)" }}>•</span>
            <span>Search your own name:</span>
            <span className="mono">{myName}</span>
          </div>
        )}

        <div className="hint" style={{ marginTop: 10 }}>
          <span>Try:</span>
          <span className="mono">BudgetDad</span>
          <span>or</span>
          <span className="mono">1001</span>
          <span style={{ color: "var(--muted2)" }}>•</span>
          <span>Name search is cache-based</span>
        </div>

        <div className="pills compact" style={{ marginTop: 12 }}>
          <span className="pill">
            <span className="chip" />
            Browse free
          </span>
          <span className="pill alt">
            <span className="chip" />
            Verify to send
          </span>
          <span className="pill mono">
            <span className="chip" />
            One prop per session
          </span>
        </div>
      </div>

      {showIntroEmpty && (
        <div className="card card-pad">
          <h2>What you’ll see</h2>
          <div className="subtle" style={{ marginTop: 10 }}>
            A driver profile (total Props + reasons) and their last sessions so you can then give Props to someone from
            that race.
          </div>
        </div>
      )}

      {showNoResults && (
        <div className="card card-pad">
          <h2>No results</h2>
          <div className="subtle" style={{ marginTop: 10 }}>
            This search only looks through drivers we’ve seen in imported sessions. Try a shorter search, or verify and
            sync your recent races to populate your world.
          </div>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="stack">
          {results.map((d) => (
            <Link
              key={d.id}
              to={`/d/${d.id}`}
              className="card card-pad card-hover"
              style={{ textDecoration: "none", color: "inherit" }}
            >
              <div className="row space-between wrap">
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 900, color: "var(--text)" }}>{d.name}</div>
                  <div className="subtle mono">ID: {d.id}</div>
                </div>

                <span className="badge">
                  <span className="badge-dot" />
                  Props <strong style={{ color: "var(--text)", fontWeight: 900 }}>{d.propsReceived ?? 0}</strong>
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Leaderboard + Recent GGs (top aligned) */}
      <div className="row wrap" style={{ gap: 14, alignItems: "flex-start" }}>
        <div className="card card-pad" style={{ flex: 1, minWidth: 320 }}>
          <div className="row space-between wrap" style={{ marginBottom: 10, alignItems: "center" }}>
            <h2 style={{ margin: 0 }}>Leaderboard</h2>
            <div className="row" style={{ gap: 8 }}>
              <button className={`btn ${lbWindow === "7d" ? "btn-primary" : ""}`} onClick={() => setLbWindow("7d")}>
                7d
              </button>
              <button className={`btn ${lbWindow === "30d" ? "btn-primary" : ""}`} onClick={() => setLbWindow("30d")}>
                30d
              </button>
              <button className={`btn ${lbWindow === "all" ? "btn-primary" : ""}`} onClick={() => setLbWindow("all")}>
                All
              </button>
            </div>
          </div>

          {lbBusy ? (
            <div className="subtle">Loading…</div>
          ) : leaderboard.length === 0 ? (
            <div className="subtle">No leaderboard yet — once people start sending Props, this fills in.</div>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              {leaderboard.map((r, idx) => (
                <Link
                  key={r.id}
                  to={`/d/${r.id}`}
                  className="card card-pad card-hover"
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <div className="row space-between wrap">
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 900 }}>
                        <span className="mono" style={{ marginRight: 10 }}>
                          #{idx + 1}
                        </span>
                        {r.name}
                      </div>
                      <div className="subtle mono">ID: {r.id}</div>
                    </div>
                    <span className="badge">
                      <span className="badge-dot" />
                      Props <strong>{r.propsReceived}</strong>
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="card card-pad" style={{ flex: 1, minWidth: 320 }}>
          <div className="row space-between wrap" style={{ marginBottom: 10, alignItems: "center" }}>
            <h2 style={{ margin: 0 }}>Recent GGs</h2>
            <span className="subtle">Latest props across cached sessions</span>
          </div>

          {feedBusy ? (
            <div className="subtle">Loading…</div>
          ) : feed.length === 0 ? (
            <div className="subtle">No recent props yet — go send some positivity.</div>
          ) : (
            <div className="stack" style={{ gap: 10 }}>
              {feed.map((x, i) => (
                <Link
                  key={`${x.createdAt}-${x.sessionId}-${i}`}
                  to={`/s/${x.sessionId}`}
                  className="card card-pad card-hover"
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <div style={{ fontWeight: 900 }}>
                    {x.fromName ? (
                      <Link to={`/d/${x.fromDriverId}`} style={{ color: "inherit", textDecoration: "none" }}>
                        {x.fromName}
                      </Link>
                    ) : (
                      "Someone"
                    )}{" "}
                    →{" "}
                    <Link to={`/d/${x.toDriverId}`} style={{ color: "inherit", textDecoration: "none" }}>
                      {x.toName ?? `Driver ${x.toDriverId}`}
                    </Link>{" "}
                    <span style={{ color: "var(--muted)" }}>•</span> {displayReason(x.reason)}
                  </div>

                  <div className="subtle" style={{ marginTop: 4 }}>
                    {x.seriesName ?? "Session"} <span style={{ color: "var(--muted2)" }}>•</span> {x.trackName ?? "Track"}{" "}
                    <span style={{ color: "var(--muted2)" }}>•</span> {new Date(x.createdAt).toLocaleString()}{" "}
                    <span style={{ color: "var(--muted2)" }}>•</span> <span className="mono">Session {x.sessionId}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}