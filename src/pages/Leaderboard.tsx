import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

type Row = { id: string; name: string; props: number };

export default function Leaderboard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [window, setWindow] = useState<"7d" | "30d">("7d");

  useEffect(() => {
    (async () => {
      const r = await fetch(`/api/leaderboard?window=${window}`);
      const j = await r.json();
      setRows(j.rows || []);
    })();
  }, [window]);

  return (
    <div className="stack">
      <div className="card card-pad">
        <div className="row space-between wrap">
          <div>
            <h1 className="mt-0" style={{ marginBottom: 6 }}>
              Top Props
            </h1>
            <div className="subtle">Who’s getting the most love for clean racing</div>
          </div>

          <div className="row">
            <button
              className={`btn ${window === "7d" ? "btn-primary" : ""}`}
              onClick={() => setWindow("7d")}
            >
              7 days
            </button>
            <button
              className={`btn ${window === "30d" ? "btn-primary" : ""}`}
              onClick={() => setWindow("30d")}
            >
              30 days
            </button>
          </div>
        </div>
      </div>

      <div className="card card-pad">
        <h2>Leaderboard</h2>

        <div className="stack" style={{ marginTop: 12, gap: 10 }}>
          {rows.length === 0 ? (
            <div className="subtle">No props yet — go start a positivity meta. 🙂</div>
          ) : (
            rows.map((r, idx) => (
              <div key={r.id} className="card card-pad card-hover">
                <div className="row space-between wrap">
                  <div className="row" style={{ gap: 12 }}>
                    <span
                      className="badge"
                      style={{ minWidth: 64, justifyContent: "center" }}
                    >
                      <span className="badge-dot" />
                      #{idx + 1}
                    </span>

                    <div style={{ minWidth: 0 }}>
                      <Link
                        to={`/d/${r.id}`}
                        style={{
                          textDecoration: "none",
                          color: "var(--text)",
                          fontWeight: 900,
                        }}
                      >
                        {r.name}
                      </Link>
                      <div className="subtle mono">ID: {r.id}</div>
                    </div>
                  </div>

                  <span className="badge">
                    <span className="badge-dot" />
                    Props{" "}
                    <strong style={{ color: "var(--text)", fontWeight: 900 }}>
                      {r.props}
                    </strong>
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
