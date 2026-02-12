export default function About() {
  return (
    <div className="stack">
      <div className="card card-pad">
        <div className="row space-between wrap">
          <div>
            <h1 className="mt-0" style={{ marginBottom: 6 }}>
              About GridRep
            </h1>
            <div className="subtle">
              A clean, lightweight way to reward good racecraft with <strong>Props (GG)</strong>.
            </div>
          </div>

          <span className="badge">
            <span className="badge-dot" />
            Built for clean racing
          </span>
        </div>
      </div>

      <div className="card card-pad">
        <h2>What it is</h2>
        <p style={{ marginTop: 10 }}>
          GridRep is a community tool for sim racing that lets drivers give <strong>Props (GG)</strong>{" "}
          after a race, kind of like a quick “good battle” nod that actually shows up on a profile.
        </p>

        <div className="pills" style={{ marginTop: 12 }}>
          <span className="pill">
            <span className="chip" />
            Fast
          </span>
          <span className="pill alt">
            <span className="chip" />
            Lightweight
          </span>
          <span className="pill mono">
            <span className="chip" />
            No drama
          </span>
        </div>
      </div>

      <div className="card card-pad">
        <h2>How it works</h2>
        <div className="stack" style={{ marginTop: 12, gap: 10 }}>
          <div className="card card-pad">
            <div style={{ fontWeight: 900, marginBottom: 4 }}>1) Browse</div>
            <div className="subtle">Search drivers and view recent sessions without logging in.</div>
          </div>

          <div className="card card-pad">
            <div style={{ fontWeight: 900, marginBottom: 4 }}>2) Verify (optional)</div>
            <div className="subtle">
              To send Props, you verify with iRacing via OAuth. GridRep never sees your password.
            </div>
          </div>

          <div className="card card-pad">
            <div style={{ fontWeight: 900, marginBottom: 4 }}>3) Send Props (GG)</div>
            <div className="subtle">
              Pick a reason (Clean battle, Respectful driving, Great racecraft, etc.) and send it.
              Props are only allowed for sessions you actually participated in.
            </div>
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <h2>Why it exists</h2>
        <p style={{ marginTop: 10 }}>
          Sim racing already has “stick” mechanics (penalties, protests). GridRep is the “carrot”, a simple way to reinforce clean, respectful racing and make it visible.
        </p>
      </div>
    </div>
  );
}
