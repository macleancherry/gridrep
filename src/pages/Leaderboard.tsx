import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

type Row = { id: string; name: string; props: number };

type LoadState =
  | { status: "loading" }
  | { status: "ready"; rows: Row[] }
  | { status: "error"; message: string };

function normalizeRows(payload: any): Row[] {
  const rows = payload?.rows ?? payload?.results ?? payload?.data ?? [];
  if (!Array.isArray(rows)) return [];
  return rows
    .map((r: any) => ({
      id: String(r?.id ?? r?.iracing_member_id ?? r?.iracingId ?? ""),
      name: String(r?.name ?? r?.display_name ?? "Unknown"),
      props: Number(r?.props ?? r?.count ?? r?.c ?? 0),
    }))
    .filter((r: Row) => r.id && Number.isFinite(r.props));
}

export default function Leaderboard() {
  const [window, setWindow] = useState<"7d" | "30d">("7d");
  const [state, setState] = useState<LoadState>({ status: "loading" });

  async function load() {
    setState({ status: "loading" });
    try {
      const r = await fetch(`/api/leaderboard?window=${window}`, { method: "GET" });

      if (!r.ok) {
        const text = await r.text().catch(() => "");
        setState({
          status: "error",
          message: text || `Leaderboard failed (${r.status}).`,
        });
        return;
      }

      const json = await r.json().catch(() => ({}));
      const rows = normalizeRows(json);
      setState({ status: "ready", rows });
    } catch (e: any) {
      setState({ status: "error", message: e?.message ?? "Network error." });
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [window]);

  return (
    <div className="stack">
      <div className="card card-pad">
        <div className="row space-between wrap">
          <div style={{ minWidth: 0 }}>
            <h1 className="mt-0" style={{ marginBottom: 6 }}>
              Top Props
            </h1>
            <div className="subtle">Who’s getting the most love for clean racing</div>
          </div>

          <div className="row" style={{ gap: 10 }}>
            <button
              className={`btn ${window === "7d" ? "btn-primary" : ""}`}
              onClick={() => setWindow("7d")}
              type="button"
            >
              7 days
            </button>
            <button
              className={`btn ${window === "30d" ? "btn-primary" : ""}`}
              onClick={() => setWindow("30d")}
              type="button"
            >
              30 days
            </button>
          </div>
        </div>
      </div>

      {state.status === "loading" && (
        <div className="card card-pad">
          <div className="subtle">Loading leaderboard…</div>
        </div>
      )}

      {state.status === "error" && (
        <div className="card card-pad">
          <h2 className="mt-0">Couldn’t load leaderboard</h2>
          <div className="subtle" style={{ marginTop: 8 }}>
            {state.message}
          </div>
          <div className="row wrap" style={{ marginTop: 12, gap: 10 }}>
            <button className="btn btn-primary" onClick={load} type="button">
              Try again
            </button>
            <Link className="btn btn-ghost" to="/" style={{ textDecoration: "none" }}>
              Back to search →
            </Link>
          </div>
        </div>
      )}

      {state.status === "ready" && (
        <div className="card card-pad">
          <div className="row space-between wrap" style={{ marginBottom: 10 }}>
            <h2>Leaderboard</h2>
            <div className="subtle">
              Props are per driver, aggregated from all cached sessions
            </div>
          </div>

          <div className="stack" style={{ marginTop: 12, gap: 10 }}>
            {state.rows.length === 0 ? (
              <div className="subtle">
                No props yet — go start a positivity meta.
              </div>
            ) : (
              state.rows.map((r, idx) => (
                <div key={r.id} className="card card-pad card-hover">
                  <div className="row space-between wrap">
                    <div className="row" style={{ gap: 12 }}>
                      <span className="badge" style={{ minWidth: 64, justifyContent: "center" }}>
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
      )}
    </div>
  );
}
