import { useState } from "react";
import { Link } from "react-router-dom";

type DriverHit = { id: string; name: string; propsReceived?: number };

export default function Home() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<DriverHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  async function search() {
    const query = q.trim();
    if (!query) return;
    setHasSearched(true);
    setLoading(true);
    try {
      const r = await fetch(`/api/drivers/search?q=${encodeURIComponent(query)}`);
      const j = await r.json();
      setResults(j.results || []);
    } finally {
      setLoading(false);
    }
  }

  const showIntroEmpty = !hasSearched && results.length === 0;
  const showNoResults = hasSearched && results.length === 0;

  return (
    <div className="stack">
      {/* Hero + Search (single primary focus) */}
      <div className="card hero">
        <div className="row space-between wrap">
          <div style={{ minWidth: 0 }}>
            <h1 className="mt-0" style={{ marginBottom: 6 }}>
              Find a driver
            </h1>
            <div className="subtle">
              Send <strong>Props (GG)</strong> after races. A quick public nod for clean driving.
            </div>
          </div>

          <Link className="btn btn-ghost" to="/about" style={{ textDecoration: "none" }}>
            How it works →
          </Link>
        </div>

        <div className="row search-row" style={{ marginTop: 14 }}>
          <input
            className="input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search iRacing driver…"
            onKeyDown={(e) => e.key === "Enter" && search()}
          />

          <button className="btn btn-primary" onClick={search} style={{ width: 140 }}>
            {loading ? "Searching…" : "Search"}
          </button>
        </div>

        {/* Small helper row (doesn't compete with CTA) */}
        <div className="hint" style={{ marginTop: 10 }}>
          <span>Try:</span>
          <span className="mono">BudgetDad</span>
          <span>or</span>
          <span className="mono">1001</span>
          <span style={{ color: "var(--muted2)" }}>•</span>
          <span>Browse free, verify to send</span>
        </div>

        {/* Pills become secondary + compact */}
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

      {/* Empty state (only before any search) */}
      {showIntroEmpty && (
        <div className="card card-pad">
          <h2>What you’ll see</h2>
          <div className="subtle" style={{ marginTop: 10 }}>
            A driver profile (total Props + reasons) and their last sessions so you can then give Props
            to someone from that race.
          </div>
        </div>
      )}

      {/* No results state (only after searching) */}
      {showNoResults && (
        <div className="card card-pad">
          <h2>No results</h2>
          <div className="subtle" style={{ marginTop: 10 }}>
            Try a shorter search, different casing, or search by iRacing ID.
          </div>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="stack">
          {results.map((d) => (
            <div key={d.id} className="card card-pad card-hover">
              <div className="row space-between wrap">
                <div style={{ minWidth: 0 }}>
                  <Link
                    to={`/d/${d.id}`}
                    style={{ fontWeight: 900, textDecoration: "none", color: "var(--text)" }}
                  >
                    {d.name}
                  </Link>
                  <div className="subtle mono">ID: {d.id}</div>
                </div>

                <span className="badge">
                  <span className="badge-dot" />
                  Props{" "}
                  <strong style={{ color: "var(--text)", fontWeight: 900 }}>
                    {d.propsReceived ?? 0}
                  </strong>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
