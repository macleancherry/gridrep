import { Link } from "react-router-dom";

export default function About() {
  return (
    <div className="stack">
      {/* Header */}
      <div className="card card-pad">
        <div className="row space-between wrap">
          <div style={{ minWidth: 0 }}>
            <h1 className="mt-0" style={{ marginBottom: 6 }}>
              About GridRep
            </h1>
            <div className="subtle">
              A lightweight way to reward good racecraft with <strong>Props (GG)</strong>.
            </div>
          </div>

          <span className="badge">
            <span className="badge-dot" />
            Built for clean racing
          </span>
        </div>
      </div>

      {/* What it is */}
      <div className="card card-pad">
        <h2>What it is</h2>
        <p style={{ marginTop: 10 }}>
          GridRep is a community tool for sim racing. After a race, you can give another driver{" "}
          <strong>Props (GG)</strong> with a reason (clean battle, respectful driving, great
          racecraft). Think of it as a quick “good one mate” that becomes visible on a driver
          profile.
        </p>

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

      {/* How it works */}
      <div className="card card-pad">
        <div className="row space-between wrap" style={{ marginBottom: 10 }}>
          <h2>How it works</h2>
          <Link className="btn btn-ghost" to="/" style={{ textDecoration: "none" }}>
            Try it now →
          </Link>
        </div>

        <div className="stack" style={{ marginTop: 12, gap: 10 }}>
          <div className="card card-pad">
            <div style={{ fontWeight: 900, marginBottom: 4 }}>1) Browse</div>
            <div className="subtle">
              Search drivers, view profiles, and open sessions without logging in.
            </div>
          </div>

          <div className="card card-pad">
            <div style={{ fontWeight: 900, marginBottom: 4 }}>2) Verify (only if you want to send)</div>
            <div className="subtle">
              To send Props, you verify with iRacing using OAuth. GridRep never sees your iRacing
              password and never stores it.
            </div>
          </div>

          <div className="card card-pad">
            <div style={{ fontWeight: 900, marginBottom: 4 }}>3) Send Props (GG)</div>
            <div className="subtle">
              Pick a reason and send it to someone from that session.
              <br />
              <strong>Anti-impersonation:</strong> you can only send Props in races you actually
              participated in, and only to other participants in that same race.
            </div>
          </div>
        </div>
      </div>

      {/* Trust + rules */}
      <div className="card card-pad">
        <h2>Rules (to keep it legit)</h2>
        <div className="stack" style={{ marginTop: 12, gap: 8 }}>
          <div className="kv">
            <span>Browse</span>
            <strong>Always free</strong>
          </div>
          <div className="kv">
            <span>Sending Props</span>
            <strong>Requires verification</strong>
          </div>
          <div className="kv">
            <span>Where you can send</span>
            <strong>Only sessions you raced</strong>
          </div>
          <div className="kv">
            <span>How many</span>
            <strong>One prop per driver per session</strong>
          </div>
        </div>

        <div className="subtle" style={{ marginTop: 10 }}>
          We use iRacing as the source of truth for session participants. That’s how we prevent
          randoms from handing out fake Props.
        </div>
      </div>

      {/* MVP disclaimer */}
      <div className="card card-pad">
        <h2>MVP status</h2>
        <p style={{ marginTop: 10 }}>
          This is an early version. If something feels confusing, slow, or “not quite right”, that’s
          exactly the feedback we want.
        </p>
        <div className="subtle">
          Best feedback is specific: the URL you were on, what you expected, and what happened.
        </div>
      </div>

      {/* Why it exists */}
      <div className="card card-pad">
        <h2>Why it exists</h2>
        <p style={{ marginTop: 10 }}>
          Sim racing already has plenty of “stick” mechanics (penalties, protests). GridRep is the
          “carrot”: a simple way to reinforce clean, respectful racing and make it visible.
        </p>
      </div>
    </div>
  );
}
