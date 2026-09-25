import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useMyDriverName } from "../useMyDriverName";

type PaceResult =
  | { ok: true; paceMs: number; lapsUsed: number; n?: number; partial?: boolean; stdDevMs?: number }
  | { ok: false; reason: string }
  | null;

type IncidentStats = { total: number; estimated: boolean; lapsAffected: number; types: Record<string, number> };
type PositionInfo = { start: number | null; finish: number | null };
type CarInfo = { name: string | null; class: string | null };

type DriverPaceRow = {
  custId: string;
  driverName: string;
  qualifying: PaceResult;
  race: PaceResult;
  average: PaceResult;
  incidents: IncidentStats;
  position: PositionInfo;
  car: CarInfo;
  iratingChange: number | null;
  raceGapMs: number | null;
};

type SortColumn = "position" | "car" | "qualifying" | "race" | "average" | "incidents" | "irating";

function formatMs(ms: number): string {
  const totalMs = Math.round(ms);
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function PaceCell({ result, gapMs }: { result: PaceResult; gapMs?: number | null }) {
  if (!result || !result.ok) return <span className="pace-muted">—</span>;

  return (
    <>
      <span className="pace-mono">{formatMs(result.paceMs)}</span>{" "}
      <span className="pace-muted">({result.lapsUsed}{result.n ? `/${result.n}` : ""})</span>
      {typeof result.stdDevMs === "number" && result.lapsUsed > 1 && (
        <span
          className="pace-muted"
          style={{ marginLeft: 4, cursor: "help" }}
          title="How consistent these laps were, in seconds — a smaller number means tighter, more repeatable lap times rather than one lucky lap dragging the average down."
        >
          ±{(result.stdDevMs / 1000).toFixed(3)}
        </span>
      )}
      {typeof gapMs === "number" && gapMs > 0 && (
        <span
          className="pace-muted"
          style={{ marginLeft: 4, cursor: "help" }}
          title="How far behind the fastest driver's race pace this driver was."
        >
          +{(gapMs / 1000).toFixed(3)}
        </span>
      )}
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

// Partial match ("Mac" or "Cherry" should still find "Mac Cherry") rather
// than requiring the exact full name - but a 1-character query would match
// almost every row, so require enough of a name to actually mean something.
function matchesMyDriverName(driverName: string, myDriverName: string): boolean {
  const query = myDriverName.trim().toLowerCase();
  if (query.length < 2) return false;
  return driverName.toLowerCase().includes(query);
}

function compareByColumn(a: DriverPaceRow, b: DriverPaceRow, column: SortColumn): number {
  switch (column) {
    case "position":
      return (a.position.finish ?? Infinity) - (b.position.finish ?? Infinity);
    case "car":
      return `${a.car.class ?? ""} ${a.car.name ?? ""}`.trim().localeCompare(`${b.car.class ?? ""} ${b.car.name ?? ""}`.trim());
    case "incidents":
      return a.incidents.total - b.incidents.total;
    case "irating":
      return (a.iratingChange ?? -Infinity) - (b.iratingChange ?? -Infinity);
    default:
      return sortValue(a[column]) - sortValue(b[column]);
  }
}

function PositionCell({ position }: { position: PositionInfo }) {
  if (position.finish == null) return <span className="pace-muted">—</span>;

  const medal = position.finish === 1 ? "🥇" : position.finish === 2 ? "🥈" : position.finish === 3 ? "🥉" : null;
  const delta = position.start != null ? position.start - position.finish : null; // positive = gained positions

  return (
    <span
      title={position.start != null ? `Started P${position.start}, so ${delta && delta > 0 ? `gained ${delta}` : delta && delta < 0 ? `lost ${Math.abs(delta)}` : "finished where they started"}.` : undefined}
      style={position.start != null ? { cursor: "help" } : undefined}
    >
      {medal && <span style={{ marginRight: 4 }}>{medal}</span>}
      {`P${position.finish}`}
      {delta !== null && delta !== 0 && (
        <span className={delta > 0 ? "pace-positive" : "pace-negative"} style={{ marginLeft: 4 }}>
          {delta > 0 ? "▲" : "▼"}
          {Math.abs(delta)}
        </span>
      )}
    </span>
  );
}

function CarCell({ car }: { car: CarInfo }) {
  if (!car.name && !car.class) return <span className="pace-muted">—</span>;

  return (
    <span>
      {car.name}
      {car.class && (
        <span className="pace-badge" style={car.name ? { marginLeft: 6 } : undefined}>
          {car.class}
        </span>
      )}
    </span>
  );
}

function IRatingCell({ change }: { change: number | null }) {
  if (change === null) return <span className="pace-muted">—</span>;
  if (change === 0) return <span className="pace-muted">0</span>;

  return <span className={change > 0 ? "pace-positive" : "pace-negative"}>{change > 0 ? `+${change}` : change}</span>;
}

function IncidentsCell({ incidents }: { incidents: IncidentStats }) {
  if (!incidents || incidents.total === 0) return <span className="pace-muted">0</span>;

  const breakdown = Object.entries(incidents.types)
    .sort((a, b) => b[1] - a[1])
    .map(([type, n]) => `${type}: ${n}`)
    .join(", ");

  const title = incidents.estimated
    ? `iRacing didn't give us an official total for this race, so this is an estimate from ${incidents.lapsAffected} flagged lap(s) (1x off track, 2x contact/lost control): ${breakdown}`
    : `iRacing's own incident-point total for this driver, from ${incidents.lapsAffected} flagged lap(s): ${breakdown}`;

  return (
    <span title={title} style={{ cursor: "help" }}>
      {incidents.total}
      {incidents.estimated && <span className="pace-muted"> (est.)</span>} <span className="pace-muted">({breakdown})</span>
    </span>
  );
}

export default function PaceSubsession() {
  const { subsessionId } = useParams<{ subsessionId: string }>();
  const [qualN, setQualN] = useState(1);
  const [raceN, setRaceN] = useState(5);
  const [qualLapsAvailable, setQualLapsAvailable] = useState<number | null>(null);
  const [raceLapsAvailable, setRaceLapsAvailable] = useState<number | null>(null);
  const [drivers, setDrivers] = useState<DriverPaceRow[] | null>(null);
  const [hasIratingData, setHasIratingData] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortColumn, setSortColumn] = useState<SortColumn>("race");
  const [sortAsc, setSortAsc] = useState(true);
  const [myDriverName, setMyDriverName] = useMyDriverName();

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
          setHasIratingData(Boolean(data.hasIratingData));
          // The server clamps best-N to however many laps that sim-session
          // actually has - mirror that ceiling here so the inputs (and any
          // value the user types) can't ask for more than really exists.
          if (typeof data.qualLapsAvailable === "number") setQualLapsAvailable(data.qualLapsAvailable);
          if (typeof data.raceLapsAvailable === "number") setRaceLapsAvailable(data.raceLapsAvailable);
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
    const withSort = [...drivers].sort((a, b) => compareByColumn(a, b, sortColumn));
    return sortAsc ? withSort : withSort.reverse();
  }, [drivers, sortColumn, sortAsc]);

  // Jump straight to the row once the name narrows to exactly one driver -
  // no need to scroll and hunt once it's unambiguous who "me" is. Left
  // alone while it still matches several rows (or none), so typing a short
  // prefix like "Mac" doesn't yank the page around mid-keystroke.
  useEffect(() => {
    if (!sorted) return;
    const matches = sorted.filter((d) => matchesMyDriverName(d.driverName, myDriverName));
    if (matches.length !== 1) return;
    document.querySelector(".pace-row-highlighted")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [myDriverName, sorted]);

  function SortHeader({ column, label, hint }: { column: SortColumn; label: string; hint?: string }) {
    const active = sortColumn === column;
    return (
      <th
        onClick={() => toggleSort(column)}
        style={{ cursor: "pointer", userSelect: "none" }}
        title={hint ? `${hint} Click to sort.` : "Click to sort."}
      >
        {label}
        {active ? (sortAsc ? " ▲" : " ▼") : ""}
      </th>
    );
  }

  return (
    <>
      <p className="pace-hint pace-mono">Subsession #{subsessionId}</p>
      <p className="pace-hint">
        See who was fastest, most consistent, and how everyone's incidents stacked up — "clean" pace ignores laps
        with a pit stop, off-track, or contact, so it's a fair way to compare drivers.
      </p>

      <div className="pace-row" style={{ marginBottom: 24 }}>
        <label
          className="pace-hint"
          htmlFor="qual-n-input"
          style={{ margin: 0, cursor: "help" }}
          title="Average of this driver's fastest N clean qualifying laps. Lower N (like 1) rewards a single fast lap; higher N rewards being consistently quick."
        >
          Qualifying best-N{qualLapsAvailable ? ` (max ${qualLapsAvailable})` : ""}
        </label>
        <input
          id="qual-n-input"
          className="pace-input pace-input-sm"
          type="number"
          min={1}
          max={qualLapsAvailable ?? undefined}
          value={qualN}
          onChange={(e) =>
            setQualN(Math.max(1, Math.min(qualLapsAvailable ?? Infinity, Number(e.target.value) || 1)))
          }
        />

        <label
          className="pace-hint"
          htmlFor="race-n-input"
          style={{ margin: 0, cursor: "help" }}
          title="Average of this driver's fastest N clean race laps. Raise it to smooth out one good or bad lap; lower it to focus on outright pace."
        >
          Race best-N{raceLapsAvailable ? ` (max ${raceLapsAvailable})` : ""}
        </label>
        <input
          id="race-n-input"
          className="pace-input pace-input-sm"
          type="number"
          min={1}
          max={raceLapsAvailable ?? undefined}
          value={raceN}
          onChange={(e) =>
            setRaceN(Math.max(1, Math.min(raceLapsAvailable ?? Infinity, Number(e.target.value) || 5)))
          }
        />
      </div>

      <div className="pace-row" style={{ marginBottom: 8 }}>
        <label className="pace-hint" htmlFor="my-driver-name-input" style={{ margin: 0 }}>
          Highlight my row
        </label>
        <input
          id="my-driver-name-input"
          className="pace-input"
          style={{ flex: "1 1 220px" }}
          placeholder="Your driver name"
          value={myDriverName}
          onChange={(e) => setMyDriverName(e.target.value)}
        />
      </div>
      <p className="pace-hint" style={{ marginTop: -16, marginBottom: 24, fontSize: "0.82rem" }}>
        Saved on this device, so you won't need to type it again next time.
      </p>

      {loading && <p className="pace-hint">Loading…</p>}
      {error && <p className="pace-error">{error}</p>}

      {sorted && (
        <div className="pace-section">
          {sorted.length === 0 ? (
            <p className="pace-hint">No drivers found for this subsession.</p>
          ) : (
            <div className="pace-table-wrap">
              <table className="pace-table">
                <thead>
                  <tr>
                    <th>Driver</th>
                    <SortHeader column="car" label="Car" hint="The car and class this driver raced." />
                    <SortHeader
                      column="position"
                      label="Pos"
                      hint="Finish position. The arrow shows places gained (▲) or lost (▼) from the start."
                    />
                    <SortHeader
                      column="qualifying"
                      label="Qualifying pace"
                      hint="Average of this driver's fastest clean qualifying lap(s)."
                    />
                    <SortHeader
                      column="race"
                      label="Race pace"
                      hint="Average of this driver's fastest clean race laps, plus how far behind the fastest driver they were."
                    />
                    <SortHeader
                      column="average"
                      label="Average pace"
                      hint="Average across both qualifying and race clean laps combined."
                    />
                    <SortHeader
                      column="incidents"
                      label="Incidents"
                      hint="iRacing's incident-point total for this driver over the whole session."
                    />
                    {hasIratingData && (
                      <SortHeader column="irating" label="iRating" hint="How much this driver's iRating changed from this race." />
                    )}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((d) => (
                    <tr
                      key={d.custId}
                      className={matchesMyDriverName(d.driverName, myDriverName) ? "pace-row-highlighted" : undefined}
                    >
                      <td>{d.driverName}</td>
                      <td>
                        <CarCell car={d.car} />
                      </td>
                      <td>
                        <PositionCell position={d.position} />
                      </td>
                      <td>
                        <PaceCell result={d.qualifying} />
                      </td>
                      <td>
                        <PaceCell result={d.race} gapMs={d.raceGapMs} />
                      </td>
                      <td>
                        <PaceCell result={d.average} />
                      </td>
                      <td>
                        <IncidentsCell incidents={d.incidents} />
                      </td>
                      {hasIratingData && (
                        <td>
                          <IRatingCell change={d.iratingChange} />
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
