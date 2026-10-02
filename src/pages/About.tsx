export default function About() {
  return (
    <div className="stack">
      <div className="card card-pad">
        <div className="row space-between wrap">
          <div style={{ minWidth: 0 }}>
            <h1 className="mt-0" style={{ marginBottom: 6 }}>
              About GridRep
            </h1>
            <div className="subtle">Team and pace tools for sim racing endurance teams.</div>
          </div>

          <span className="badge">
            <span className="badge-dot" />
            Built for endurance racing
          </span>
        </div>
      </div>

      <div className="card card-pad">
        <h2>What it is</h2>
        <p style={{ marginTop: 10 }}>
          GridRep helps an endurance team plan and run a race: build a driver lineup, plan stints
          and pit stops around fuel and fatigue, and track the race live against that plan. Pace
          gives a clean-pace read on any iRacing session's results, and What-If recomputes a
          race's standings from any lap onward.
        </p>
      </div>

      <div className="card card-pad">
        <h2>Verification</h2>
        <p style={{ marginTop: 10 }}>
          Signing in uses iRacing's own OAuth - GridRep never sees your iRacing password and never
          stores it.
        </p>
      </div>

      <div className="card card-pad">
        <h2>Driver identity</h2>
        <p style={{ marginTop: 10 }}>
          A driver's real name is only ever shown where they've given explicit, off-platform
          consent to be identified - everyone else appears by car number and class instead. See{" "}
          <a href="/privacy">Privacy</a> for details.
        </p>
      </div>
    </div>
  );
}
