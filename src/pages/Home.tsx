import { Link } from "react-router-dom";

export default function Home() {
  return (
    <div className="stack">
      <div className="card card-pad">
        <h1 className="mt-0" style={{ marginBottom: 6 }}>
          GridRep
        </h1>
        <div className="subtle">Team and pace tools for sim racing endurance teams.</div>
      </div>

      <div className="card card-pad">
        <div style={{ fontWeight: 900, marginBottom: 4 }}>Race Planner</div>
        <div className="subtle" style={{ marginBottom: 10 }}>
          Build a lineup, plan stints and pit stops, and track a race live against the plan.
        </div>
        <Link className="btn btn-ghost" to="/race-planner" style={{ textDecoration: "none" }}>
          Open the planner →
        </Link>
      </div>

      <div className="card card-pad">
        <div style={{ fontWeight: 900, marginBottom: 4 }}>Pace</div>
        <div className="subtle" style={{ marginBottom: 10 }}>
          Clean-pace results for any iRacing session - who was fastest, most consistent, and how
          incidents stacked up.
        </div>
        <Link className="btn btn-ghost" to="/pace" style={{ textDecoration: "none" }}>
          Open Pace →
        </Link>
      </div>

      <div className="card card-pad">
        <div style={{ fontWeight: 900, marginBottom: 4 }}>What-If</div>
        <div className="subtle" style={{ marginBottom: 10 }}>
          Recompute a race's standings from any lap onward, to see how it would have played out.
        </div>
        <Link className="btn btn-ghost" to="/what-if" style={{ textDecoration: "none" }}>
          Open What-If →
        </Link>
      </div>
    </div>
  );
}
