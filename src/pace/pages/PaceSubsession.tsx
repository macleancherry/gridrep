import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

type PaceRow = {
  custId: string;
  driverName: string;
  simsessionType: "qualifying" | "race";
  ok: boolean;
  paceMs?: number;
  lapsUsed?: number;
  cleanLapCount?: number;
  n: number;
};

function formatMs(ms: number): string {
  const totalMs = Math.round(ms);
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function PaceTable({ title, rows }: { title: string; rows: PaceRow[] }) {
  const sorted = [...rows].sort((a, b) => (a.ok && b.ok ? (a.paceMs ?? 0) - (b.paceMs ?? 0) : a.ok ? -1 : 1));

  return (
    <div className="pace-section">
      <h2>{title}</h2>
      {sorted.length === 0 ? (
        <p className="pace-hint">No drivers found for this sim-session.</p>
      ) : (
        <table className="pace-table">
          <thead>
            <tr>
              <th>Driver</th>
              <th>Clean pace</th>
              <th>Laps used</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.custId}>
                <td>{r.driverName}</td>
                <td className="pace-mono">{r.ok ? formatMs(r.paceMs!) : "—"}</td>
                <td className="pace-muted">
                  {r.ok ? `${r.lapsUsed}/${r.n}` : `insufficient (${r.cleanLapCount ?? 0}/${r.n} clean)`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function PaceSubsession() {
  const { subsessionId } = useParams<{ subsessionId: string }>();
  const [n, setN] = useState(5);
  const [rows, setRows] = useState<PaceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const r = await fetch(`/api/pace/subsessions/${encodeURIComponent(subsessionId!)}/pace?laps=${n}`);
        const data = await r.json();
        if (cancelled) return;

        if (!data.ok) {
          setError(data.message ?? "Could not load pace.");
          setRows(null);
        } else {
          setRows(data.pace ?? []);
        }
      } catch {
        if (!cancelled) setError("Network error.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [subsessionId, n]);

  return (
    <>
      <p className="pace-hint pace-mono">Subsession #{subsessionId}</p>

      <div className="pace-row" style={{ marginBottom: 24 }}>
        <label className="pace-hint" htmlFor="n-input" style={{ margin: 0 }}>
          Best-N laps
        </label>
        <input
          id="n-input"
          className="pace-input"
          style={{ minWidth: 80, width: 80 }}
          type="number"
          min={1}
          max={50}
          value={n}
          onChange={(e) => setN(Math.max(1, Math.min(50, Number(e.target.value) || 5)))}
        />
      </div>

      {loading && <p className="pace-hint">Loading…</p>}
      {error && <p className="pace-error">{error}</p>}

      {rows && (
        <>
          <PaceTable title="Qualifying" rows={rows.filter((r) => r.simsessionType === "qualifying")} />
          <PaceTable title="Race" rows={rows.filter((r) => r.simsessionType === "race")} />
        </>
      )}
    </>
  );
}
