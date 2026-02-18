import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PROP_REASONS, type PropReasonId } from "../lib/propReasons";

const AUTH_BASE = "https://gridrep.gg";

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

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: SessionData }
  | { status: "needVerify"; message: string }
  | { status: "error"; message: string };

function verifyUrl() {
  return `${AUTH_BASE}/api/auth/start?returnTo=${encodeURIComponent(window.location.pathname)}`;
}

export default function Session() {
  const { sessionId } = useParams();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [reason, setReason] = useState<PropReasonId>("clean_battle");

  const reasonOptions = useMemo(() => PROP_REASONS, []);

  async function load() {
    if (!sessionId) {
      setState({ status: "error", message: "Missing session id in URL." });
      return;
    }

    setState({ status: "loading" });

    try {
      const r = await fetch(`${AUTH_BASE}/api/sessions/${sessionId}`, {
        method: "GET",
        credentials: "include",
      });

      // If backend blocks uncached sessions for non-verified viewers, it returns 404 text
      if (!r.ok) {
        const text = await r.text().catch(() => "");
        const authRequired =
          r.status === 404 &&
          (r.headers.get("X-GridRep-Auth-Required") === "1" ||
            /verify/i.test(text) ||
            /not cached/i.test(text));

        if (authRequired) {
          setState({
            status: "needVerify",
            message:
              text ||
              "This session isn’t cached yet. Verify with iRacing to load it (we’ll import it automatically).",
          });
          return;
        }

        setState({
          status: "error",
          message: text || `Failed to load session (${r.status}).`,
        });
        return;
      }

      const json = (await r.json()) as SessionData;
      setState({ status: "ready", data: json });
    } catch (e: any) {
      setState({ status: "error", message: e?.message ?? "Network error." });
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  async function sendProps(toDriverId: string) {
    if (state.status !== "ready") {
      alert("Session not loaded yet — try again in a second.");
      return;
    }

    setBusy(toDriverId);

    const r = await fetch(`${AUTH_BASE}/api/props`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ sessionId: state.data.sessionId, toDriverId, reason }),
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

  if (state.status === "loading") return <div className="subtle">Loading…</div>;

  if (state.status === "error") {
    return (
      <div className="stack">
        <div className="card card-pad">
          <h1 className="mt-0">Couldn’t load session</h1>
          <div className="subtle" style={{ marginTop: 6 }}>
            {state.message}
          </div>
          <div className="row wrap" style={{ marginTop: 12, gap: 10 }}>
            <button className="btn btn-primary" onClick={load}>
              Try again
            </button>
            <a className="btn" href={verifyUrl()} style={{ textDecoration: "none" }}>
              Verify with iRacing →
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (state.status === "needVerify") {
    return (
      <div className="stack">
        <div className="card card-pad">
          <div className="row space-between wrap">
            <div style={{ minWidth: 0 }}>
              <h1 className="mt-0" style={{ marginBottom: 6 }}>
                Verify to load this session
              </h1>
              <div className="subtle">{state.message}</div>
              <div className="subtle" style={{ marginTop: 6 }}>
                Once verified, we’ll automatically import this subsession from iRacing and cache it.
              </div>
            </div>

            <a
              className="btn btn-primary"
              href={verifyUrl()}
              style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}
            >
              Verify with iRacing →
            </a>
          </div>
        </div>

        <div className="card card-pad">
          <div className="subtle">
            You can still browse sessions that are already cached. This one isn’t cached yet.
          </div>
        </div>
      </div>
    );
  }

  // ready
  const data = state.data;

  return (
    <div className="stack">
      {/* Session header */}
      <div className="card card-pad">
        <div className="row space-between wrap">
          <div style={{ minWidth: 0 }}>
            <h1 className="mt-0" style={{ marginBottom: 6 }}>
              {data.seriesName ?? "Session"} <span style={{ color: "var(--muted)" }}>—</span>{" "}
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

      {/* Verify callout (send props) */}
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
              href={verifyUrl()}
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
            disabled={!data.viewer.verified}
            title={!data.viewer.verified ? "Verify to send props" : undefined}
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
            const disabled = !data.viewer.verified || !!p.alreadyPropped || busy === p.id;

            return (
              <div key={p.id} className="card card-pad card-hover">
                <div className="row space-between wrap">
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 900 }}>
                      {typeof p.finishPos === "number" ? (
                        <span
                          className={`pos ${
                            p.finishPos === 1
                              ? "p1"
                              : p.finishPos === 2
                              ? "p2"
                              : p.finishPos === 3
                              ? "p3"
                              : ""
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
                    title={
                      !data.viewer.verified
                        ? "Verify with iRacing to send props"
                        : p.alreadyPropped
                        ? "You already sent props to this driver in this session"
                        : undefined
                    }
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
