import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PROP_REASONS, type PropReasonId } from "../lib/propReasons";

type Participant = {
  id: string;
  name: string;
  finishPos?: number;
  carName?: string;
  props: number;
  alreadyPropped?: boolean;
};

type SessionData = {
  sessionId: string;
  startTime: string;
  seriesName?: string;
  trackName?: string;
  participants: Participant[];
  viewer: { verified: boolean };
};

export default function Session() {
  const { sessionId } = useParams();
  const [data, setData] = useState<SessionData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [reason, setReason] = useState<PropReasonId>("clean_battle");

  const reasonOptions = useMemo(() => PROP_REASONS, []);

  async function load() {
    const r = await fetch(`/api/sessions/${sessionId}`);
    setData(await r.json());
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  async function sendProps(toDriverId: string) {
    setBusy(toDriverId);
    const r = await fetch(`/api/props`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, toDriverId, reason }),
    });

    if (r.status === 401) {
      window.location.href = `/api/auth/start?returnTo=${encodeURIComponent(window.location.pathname)}`;
      return;
    }

    setBusy(null);
    await load();
  }

  if (!data) return <div>Loading…</div>;

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>
        {data.seriesName ?? "Session"} — {data.trackName ?? "Track"}
      </h1>
      <div style={{ color: "#666" }}>
        {new Date(data.startTime).toLocaleString()} • Session ID: {data.sessionId}
      </div>

      {!data.viewer.verified && (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #eee", borderRadius: 10 }}>
          Want to send Props (GG)?{" "}
          <a href={`/api/auth/start?returnTo=${encodeURIComponent(window.location.pathname)}`}>
            Verify with iRacing
          </a>{" "}
          (we never see your password).
        </div>
      )}

      <div style={{ marginTop: 16, padding: 12, border: "1px solid #eee", borderRadius: 10 }}>
        <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>Why the Props (GG)?</div>
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value as PropReasonId)}
          style={{ padding: 10, minWidth: 260 }}
        >
          {reasonOptions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      <h2 style={{ marginTop: 24 }}>Drivers</h2>
      <div style={{ display: "grid", gap: 10 }}>
        {data.participants.map((p) => (
          <div
            key={p.id}
            style={{
              padding: 12,
              border: "1px solid #eee",
              borderRadius: 10,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>
                {typeof p.finishPos === "number" ? `P${p.finishPos} ` : ""}
                <Link to={`/d/${p.id}`}>{p.name}</Link>
              </div>
              <div style={{ color: "#666", fontSize: 13 }}>
                {p.carName ?? ""} • Props: {p.props}
              </div>
            </div>

            <button
              disabled={!data.viewer.verified || p.alreadyPropped || busy === p.id}
              onClick={() => sendProps(p.id)}
              style={{ padding: "10px 12px" }}
            >
              {p.alreadyPropped ? "Props sent ✅" : busy === p.id ? "Sending…" : "Send Props (GG) 👍"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
