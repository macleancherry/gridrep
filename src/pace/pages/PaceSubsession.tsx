import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";

type PaceResult =
  | { ok: true; paceMs: number; lapsUsed: number; n?: number; partial?: boolean }
  | { ok: false; reason: string }
  | null;

type IncidentStats = { count: number; types: Record<string, number> };

type DriverPaceRow = {
  custId: string;
  driverName: string;
  qualifying: PaceResult;
  race: PaceResult;
  average: PaceResult;
  incidents: IncidentStats;
};

type SortColumn = "qualifying" | "race" | "average" | "incidents";

function formatMs(ms: number): string {
  const totalMs = Math.round(ms);
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function PaceCell({ result }: { result: PaceResult }) {
  if (!result || !result.ok) return <span className="pace-muted">—</span>;

  return (
    <>
      <span className="pace-mono">{formatMs(result.paceMs)}</span>{" "}
      <span className="pace-muted">({result.lapsUsed}{result.n ? `/${result.n}` : ""})</span>
      {result.partial && (
        <span
          className="pace-error"
          title={`Only ${result.lapsUsed} of the requested ${result.n} clean laps were available — this pace is an average of what's there.`}
          style={{ marginLeft: 4, cursor: "help" }}
        >
          ⚠
        </span>
      )}
    </>
  );
}

function sortValue(result: PaceResult): number {
  return result?.ok ? result.paceMs : Infinity;
}

function IncidentsCell({ incidents }: { incidents: IncidentStats }) {
  if (!incidents || incidents.count === 0) return <span className="pace-muted">0</span>;

  const breakdown = Object.entries(incidents.types)
    .sort((a, b) => b[1] - a[1])
    .map(([type, n]) => `${type}: ${n}`)
    .join(", ");

  return (
    <span title={breakdown} style={{ cursor: "help" }}>
      {incidents.count} <span className="pace-muted">({breakdown})</span>
    </span>
  );
}

export default function PaceSubsession() {
  const { subsessionId } = useParams<{ subsessionId: string }>();
  const [qualN, setQualN] = useState(1);
  const [raceN, setRaceN] = useState(5);
  const [drivers, setDrivers] = useState<DriverPaceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortColumn, setSortColumn] = useState<SortColumn>("race");
  const [sortAsc, setSortAsc] = useState(true);

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

  function toggleSort(column: SortColumn) {
    if (column === sortColumn) {
      setSortAsc((v) => !v);
    } else {
      setSortColumn(column);
      setSortAsc(true);
    }
  }

  const sorted = useMemo(() => {
    if (!drivers) return null;
    const valueOf = (d: DriverPaceRow) => (sortColumn === "incidents" ? d.incidents.count : sortValue(d[sortColumn]));
    const withSort = [...drivers].sort((a, b) => valueOf(a) - valueOf(b));
    return sortAsc ? withSort : withSort.reverse();
  }, [drivers, sortColumn, sortAsc]);

  function SortHeader({ column, label }: { column: SortColumn; label: string }) {
    const active = sortColumn === column;
    return (
      <th
        onClick={() => toggleSort(column)}
        style={{ cursor: "pointer", userSelect: "none" }}
        title="Click to sort"
      >
        {label}
        {active ? (sortAsc ? " ▲" : " ▼") : ""}
      </th>
    );
  }

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
                  <SortHeader column="qualifying" label="Qualifying pace" />
                  <SortHeader column="race" label="Race pace" />
                  <SortHeader column="average" label="Average pace" />
                  <SortHeader column="incidents" label="Incidents" />
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
                    <td>
                      <PaceCell result={d.average} />
                    </td>
                    <td>
                      <IncidentsCell incidents={d.incidents} />
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
