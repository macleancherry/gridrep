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

  if (!data) return <div>Loading…</div>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>{data.name}</h1>
      <div style={{ color: "#666" }}>iRacing ID: {data.id}</div>

      <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ padding: 12, border: "1px solid #eee", borderRadius: 10 }}>
          <div style={{ fontSize: 13, color: "#666" }}>Props received</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{data.propsReceived}</div>
        </div>

        <div style={{ padding: 12, border: "1px solid #eee", borderRadius: 10, minWidth: 280 }}>
          <div style={{ fontSize: 13, color: "#666" }}>Props by reason</div>
          <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
            {PROP_REASONS.map((r) => (
              <div key={r.id} style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{r.label}</span>
                <strong>{data.propsByReason?.[r.id] ?? 0}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>

      <h2 style={{ marginTop: 24 }}>Last 5 sessions</h2>
      {data.recentSessions.map((s) => (
        <Link
          key={s.sessionId}
          to={`/s/${s.sessionId}`}
          style={{
            display: "block",
            padding: 12,
            border: "1px solid #eee",
            borderRadius: 10,
            marginBottom: 10,
            textDecoration: "none",
            color: "inherit",
          }}
        >
          <div style={{ fontWeight: 600 }}>
            {s.seriesName ?? "Session"} — {s.trackName ?? "Track"}
          </div>
          <div style={{ color: "#666", fontSize: 13 }}>
            {new Date(s.startTime).toLocaleString()} • Session ID: {s.sessionId}
            {typeof s.finishPos === "number" ? ` • P${s.finishPos}` : ""}
          </div>
        </Link>
      ))}
    </div>
  );
}
