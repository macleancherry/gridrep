import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PROP_REASONS } from "../lib/propReasons";

type DriverProfile = {
  id: string;
  name: string;
  propsReceived: number;
  propsByReason: Record<string, number>;
  recentSessions: Array<{
    sessionId: string;
    startTime: string;
    seriesName?: string;
    trackName?: string;
    finishPos?: number;
  }>;
};

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: DriverProfile }
  | { status: "notFound"; message: string }
  | { status: "error"; message: string };

export default function Driver() {
  const { driverId } = useParams();
  const [state, setState] = useState<LoadState>({ status: "loading" });

  async function load() {
    if (!driverId) {
      setState({ status: "error", message: "Missing driver id in URL." });
      return;
    }

    setState({ status: "loading" });

    try {
      const r = await fetch(`/api/drivers/${driverId}`, { method: "GET" });

      if (!r.ok) {
        const text = await r.text().catch(() => "");
        if (r.status === 404) {
          setState({
            status: "notFound",
            message:
              text ||
              "That driver isn’t in GridRep yet. Try opening a session first (which will cache participants), then come back.",
          });
          return;
        }

        setState({
          status: "error",
          message: text || `Failed to load driver (${r.status}).`,
        });
        return;
      }

      const json = (await r.json()) as DriverProfile;
      setState({ status: "ready", data: json });
    } catch (e: any) {
      setState({ status: "error", message: e?.message ?? "Network error." });
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverId]);

  if (state.status === "loading") return <div className="subtle">Loading…</div>;

  if (state.status === "error") {
    return (
      <div className="stack">
        <div className="card card-pad">
          <h1 className="mt-0">Couldn’t load driver</h1>
          <div className="subtle" style={{ marginTop: 6 }}>
            {state.message}
          </div>

          <div className="row wrap" style={{ marginTop: 12, gap: 10 }}>
            <button className="btn btn-primary" onClick={load}>
              Try again
            </button>
            <Link className="btn" to="/" style={{ textDecoration: "none" }}>
              Go home →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (state.status === "notFound") {
    return (
      <div className="stack">
        <div className="card card-pad">
          <h1 className="mt-0">Driver not found</h1>
          <div className="subtle" style={{ marginTop: 6 }}>
            {state.message}
          </div>

          <div className="row wrap" style={{ marginTop: 12, gap: 10 }}>
            <Link className="btn btn-primary" to="/" style={{ textDecoration: "none" }}>
              Search / browse →
            </Link>
          </div>
        </div>

        <div className="card card-pad">
          <div className="subtle">
            Tip: if you open a session page (subsession) that includes this driver, GridRep will cache the participants
            and this profile will start showing up with their last 5 sessions.
          </div>
        </div>
      </div>
    );
  }

  const data = state.data;

  return (
    <div className="stack">
      <div className="card card-pad">
        <div className="row space-between wrap">
          <div style={{ minWidth: 0 }}>
            <h1 className="mt-0" style={{ marginBottom: 6 }}>
              {data.name}
            </h1>
            <div className="subtle mono">iRacing ID: {data.id}</div>
          </div>

          <span className="badge">
            <span className="badge-dot" />
            Driver profile
          </span>
        </div>
      </div>

      <div className="row wrap">
        <div className="card card-pad" style={{ minWidth: 220 }}>
          <h2>Props received</h2>
          <div style={{ fontSize: 34, fontWeight: 900, marginTop: 8 }}>
            {data.propsReceived}
          </div>
          <div className="subtle" style={{ marginTop: 4 }}>
            Total across all sessions
          </div>
        </div>

        <div className="card card-pad" style={{ flex: 1, minWidth: 280 }}>
          <h2>Props by reason</h2>
          <div className="stack" style={{ marginTop: 12, gap: 8 }}>
            {PROP_REASONS.map((r) => (
              <div key={r.id} className="kv">
                <span>{r.label}</span>
                <strong>{data.propsByReason?.[r.id] ?? 0}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Small hint (because sessions may require auth to import if uncached) */}
      <div className="card card-pad">
        <div className="subtle">
          Some sessions may require verification to load if GridRep hasn’t cached them yet.
        </div>
      </div>

      <div className="card card-pad">
        <div className="row space-between wrap" style={{ marginBottom: 10 }}>
          <h2>Last 5 sessions</h2>
          <span className="subtle">Click a session to send Props (GG)</span>
        </div>

        {data.recentSessions?.length ? (
          <div className="stack" style={{ gap: 10 }}>
            {data.recentSessions.map((s) => (
              <Link
                key={s.sessionId}
                to={`/s/${s.sessionId}`}
                className="card card-pad card-hover"
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <div className="row space-between wrap">
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 900, color: "var(--text)" }}>
                      {s.seriesName ?? "Session"}{" "}
                      <span style={{ color: "var(--muted)" }}>—</span>{" "}
                      {s.trackName ?? "Track"}
                    </div>

                    <div className="subtle">
                      {new Date(s.startTime).toLocaleString()}{" "}
                      <span style={{ color: "var(--muted2)" }}>•</span>{" "}
                      <span className="mono">Session ID: {s.sessionId}</span>
                      {typeof s.finishPos === "number" ? (
                        <>
                          {" "}
                          <span style={{ color: "var(--muted2)" }}>•</span> P{s.finishPos}
                        </>
                      ) : null}
                    </div>
                  </div>

                  <button className="btn btn-ghost" type="button">
                    View →
                  </button>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="subtle">
            No recent sessions cached for this driver yet. Open a session that includes them and this will fill in.
          </div>
        )}
      </div>
    </div>
  );
}
