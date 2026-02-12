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
    if (!data?.sessionId) {
      alert("Session not loaded yet — try again in a second.");
      return;
    }

    setBusy(toDriverId);

    const r = await fetch(`/api/props`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: data.sessionId, toDriverId, reason }),
    });

    if (!r.ok) {
      const msg = await r.text();
      console.error("Props failed:", r.status, msg);
      alert(`Props failed (${r.status}): ${msg}`);
      setBusy(null);
      return;
    }

    setBusy(null);
    await load();
  }

  if (!data) return <div className="subtle">Loading…</div>;

  return (
    <div className="stack">
      {/* Session header */}
      <div className="card card-pad">
        <div className="row space-between wrap">
          <div style={{ minWidth: 0 }}>
            <h1 className="mt-0" style={{ marginBottom: 6 }}>
              {data.seriesName ?? "Session"}{" "}
              <span style={{ color: "var(--muted)" }}>—</span>{" "}
              {data.trackName ?? "Track"}
            </h1>
<div className="pills" style={{ marginTop: 10 }}>
  <span className="pill">
    <span className="chip" />
    Series <strong>{data.seriesName ?? "Session"}</strong>
  </span>

  <span className="pill alt">
    <span className="chip" />
    Track <strong>{data.trackName ?? "Track"}</strong>
  </span>

  <span className="pill mono">
    <span className="chip" />
    {new Date(data.startTime).toLocaleString()}
  </span>

  <span className="pill mono">
    <span className="chip" />
    ID <strong>{data.sessionId}</strong>
  </span>
</div>

          </div>

          <span className="badge">
            <span className="badge-dot" />
            {data.viewer.verified ? "Verified" : "Browse mode"}
          </span>
        </div>
      </div>

      {/* Verify callout */}
      {!data.viewer.verified && (
        <div className="card card-pad">
          <div className="row space-between wrap">
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 900, marginBottom: 4 }}>Want to send Props (GG)?</div>
              <div className="subtle">
                Verify with iRacing to prevent impersonation. We never see your password.
              </div>
            </div>

            <a
              className="btn btn-primary"
              href={`/api/auth/start?returnTo=${encodeURIComponent(window.location.pathname)}`}
              style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}
            >
              Verify with iRacing →
            </a>
          </div>
        </div>
      )}

      {/* Reason selector */}
      <div className="card card-pad">
        <h2>Reason</h2>
        <div className="subtle" style={{ marginTop: 6 }}>
          Why are you giving Props (GG)?
        </div>

        <div className="row wrap" style={{ marginTop: 12 }}>
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value as PropReasonId)}
            style={{ maxWidth: 420 }}
          >
            {reasonOptions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>

          <span className="badge">
            <span className="badge-dot" />
            Pick once, then spam positivity
          </span>
        </div>
      </div>

      {/* Drivers */}
      <div className="card card-pad">
        <div className="row space-between wrap" style={{ marginBottom: 10 }}>
          <h2>Drivers</h2>
          <div className="subtle">Give Props to someone you raced clean with</div>
        </div>

        <div className="stack" style={{ gap: 10 }}>
          {data.participants.map((p) => {
            const disabled = !data.viewer.verified || p.alreadyPropped || busy === p.id;

            return (
              <div key={p.id} className="card card-pad card-hover">
                <div className="row space-between wrap">
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 900 }}>
{typeof p.finishPos === "number" ? (
  <span
    className={`pos ${
      p.finishPos === 1 ? "p1" : p.finishPos === 2 ? "p2" : p.finishPos === 3 ? "p3" : ""
    }`}
    style={{ marginRight: 10 }}
  >
    P{p.finishPos}
  </span>
) : null}

                      <Link
                        to={`/d/${p.id}`}
                        style={{ textDecoration: "none", color: "var(--text)" }}
                      >
                        {p.name}
                      </Link>
                    </div>

<div className="subtle">
  <span className="mono">{p.carName ?? ""}</span>{" "}
  <span style={{ color: "var(--muted2)" }}>•</span>{" "}
  Props <strong style={{ color: "var(--text)" }}>{p.props}</strong>
</div>

                  </div>

                  <button
                    className={`btn ${p.alreadyPropped ? "btn-success" : "btn-primary"}`}
                    disabled={disabled}
                    onClick={() => sendProps(p.id)}
                  >
                    {p.alreadyPropped
                      ? "Props sent ✅"
                      : busy === p.id
                      ? "Sending…"
                      : "Send Props (GG) 👍"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
