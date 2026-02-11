import { useState } from "react";
import { Link } from "react-router-dom";

type DriverHit = { id: string; name: string; propsReceived?: number };

export default function Home() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<DriverHit[]>([]);
  const [loading, setLoading] = useState(false);

  async function search() {
    const query = q.trim();
    if (!query) return;
    setLoading(true);
    const r = await fetch(`/api/drivers/search?q=${encodeURIComponent(query)}`);
    const j = await r.json();
    setResults(j.results || []);
    setLoading(false);
  }

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Find a driver</h1>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search iRacing driver…"
          style={{ flex: 1, padding: 10 }}
          onKeyDown={(e) => e.key === "Enter" && search()}
        />
        <button onClick={search} style={{ padding: "10px 14px" }}>
          {loading ? "Searching…" : "Search"}
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        {results.map((d) => (
          <div
            key={d.id}
            style={{
              padding: 12,
              border: "1px solid #eee",
              borderRadius: 10,
              marginBottom: 10,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <Link to={`/d/${d.id}`} style={{ fontWeight: 600 }}>
                {d.name}
              </Link>
              <div style={{ color: "#666", fontSize: 13 }}>ID: {d.id}</div>
            </div>
            <div>Props: {d.propsReceived ?? 0}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
