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

export default function Driver() {
  const { driverId } = useParams();
  const [data, setData] = useState<DriverProfile | null>(null);

  useEffect(() => {
    (async () => {
      const r = await fetch(`/api/drivers/${driverId}`);
      setData(await r.json());
    })();
  }, [driverId]);

  if (!data) return <div className="subtle">Loading…</div>;

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

      <div className="card card-pad">
        <div className="row space-between wrap" style={{ marginBottom: 10 }}>
          <h2>Last 5 sessions</h2>
          <span className="subtle">Click a session to send Props (GG)</span>
        </div>

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
      </div>
    </div>
  );
}
