import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

type PaceResult =
  | { ok: true; paceMs: number; lapsUsed: number; n: number }
  | { ok: false; reason: string; cleanLapCount: number; n: number }
  | null;

type DriverPaceRow = {
  custId: string;
  driverName: string;
  qualifying: PaceResult;
  race: PaceResult;
};

function formatMs(ms: number): string {
  const totalMs = Math.round(ms);
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function PaceCell({ result }: { result: PaceResult }) {
  if (!result) return <span className="pace-muted">—</span>;
  if (result.ok) {
    return (
      <>
        <span className="pace-mono">{formatMs(result.paceMs)}</span>{" "}
        <span className="pace-muted">({result.lapsUsed}/{result.n})</span>
      </>
    );
  }
  return <span className="pace-muted">insufficient ({result.cleanLapCount}/{result.n} clean)</span>;
}

export default function PaceSubsession() {
  const { subsessionId } = useParams<{ subsessionId: string }>();
  const [qualN, setQualN] = useState(1);
  const [raceN, setRaceN] = useState(5);
  const [drivers, setDrivers] = useState<DriverPaceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const r = await fetch(
          `/api/pace/subsessions/${encodeURIComponent(subsessionId!)}/pace?qualLaps=${qualN}&raceLaps=${raceN}`
        );
        const data = await r.json();
        if (cancelled) return;

        if (!data.ok) {
          setError(data.message ?? "Could not load pace.");
          setDrivers(null);
        } else {
          setDrivers(data.drivers ?? []);
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
  }, [subsessionId, qualN, raceN]);

  const sorted = drivers
    ? [...drivers].sort((a, b) => {
        const aMs = a.race?.ok ? a.race.paceMs : a.qualifying?.ok ? a.qualifying.paceMs : Infinity;
        const bMs = b.race?.ok ? b.race.paceMs : b.qualifying?.ok ? b.qualifying.paceMs : Infinity;
        return aMs - bMs;
      })
    : null;

  return (
    <>
      <p className="pace-hint pace-mono">Subsession #{subsessionId}</p>

      <div className="pace-row" style={{ marginBottom: 24 }}>
        <label className="pace-hint" htmlFor="qual-n-input" style={{ margin: 0 }}>
          Qualifying best-N
        </label>
        <input
          id="qual-n-input"
          className="pace-input"
          style={{ minWidth: 70, width: 70 }}
          type="number"
          min={1}
          max={50}
          value={qualN}
          onChange={(e) => setQualN(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
        />

        <label className="pace-hint" htmlFor="race-n-input" style={{ margin: 0 }}>
          Race best-N
        </label>
        <input
          id="race-n-input"
          className="pace-input"
          style={{ minWidth: 70, width: 70 }}
          type="number"
          min={1}
          max={50}
          value={raceN}
          onChange={(e) => setRaceN(Math.max(1, Math.min(50, Number(e.target.value) || 5)))}
        />
      </div>

      {loading && <p className="pace-hint">Loading…</p>}
      {error && <p className="pace-error">{error}</p>}

      {sorted && (
        <div className="pace-section">
          {sorted.length === 0 ? (
            <p className="pace-hint">No drivers found for this subsession.</p>
          ) : (
            <table className="pace-table">
              <thead>
                <tr>
                  <th>Driver</th>
                  <th>Qualifying pace</th>
                  <th>Race pace</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((d) => (
                  <tr key={d.custId}>
                    <td>{d.driverName}</td>
                    <td>
                      <PaceCell result={d.qualifying} />
                    </td>
                    <td>
                      <PaceCell result={d.race} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </>
  );
}
