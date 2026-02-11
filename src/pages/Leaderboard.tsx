import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

export default function Leaderboard() {
  const [rows, setRows] = useState<Array<{ id: string; name: string; props: number }>>([]);

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/leaderboard?window=7d");
      const j = await r.json();
      setRows(j.rows || []);
    })();
  }, []);

  return (
    <div>
      <h1 style={{ marginTop: 0 }}>Top Props (7 days)</h1>
      {rows.map((r, idx) => (
        <div key={r.id} style={{ padding: 10, borderBottom: "1px solid #eee" }}>
          <strong>#{idx + 1}</strong> <Link to={`/d/${r.id}`}>{r.name}</Link> — {r.props}
        </div>
      ))}
    </div>
  );
}
