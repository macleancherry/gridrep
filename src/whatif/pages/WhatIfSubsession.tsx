import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

type StandingRow = {
  custId: string;
  driverName: string;
  position: number | null;
  status: "classified" | "no_timed_laps" | "dnf_before_cutoff";
  totalTimeMs: number | null;
  avgLapMs: number | null;
  gapMs: number | null;
  lapsDown: number;
  lapsUsed: number;
  lapsInRange: number;
  lastLapNumber: number | null;
  partial: boolean;
  pitLapsEstimated: number;
  nearReference: boolean;
};

type ReferenceDriver = { custId: string; driverName: string };
type SortColumn = "position" | "avgLap";

function formatMs(ms: number): string {
  const totalMs = Math.round(ms);
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function statusLabel(row: StandingRow): string {
  if (row.status === "dnf_before_cutoff") return "Did not reach the cutoff moment";
  if (row.status === "no_timed_laps") return "No timed laps after the cutoff moment";
  return "";
}

export default function WhatIfSubsession() {
  const { subsessionId } = useParams<{ subsessionId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const [fromLapInput, setFromLapInput] = useState(() => Math.max(1, Number(searchParams.get("fromLap")) || 1));
  const [driverInput, setDriverInput] = useState(() => searchParams.get("driver") ?? "");
  const [rows, setRows] = useState<StandingRow[] | null>(null);
  const [referenceDriver, setReferenceDriver] = useState<ReferenceDriver | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sortColumn, setSortColumn] = useState<SortColumn>("position");
  const [sortAsc, setSortAsc] = useState(true);

  const fromLap = Math.max(1, Number(searchParams.get("fromLap")) || 1);
  const driverQuery = (searchParams.get("driver") ?? "").trim();
  const excludePitLaps = searchParams.get("excludePitLaps") === "true";

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      if (!driverQuery) {
        setError("Enter a driver name to anchor the cutoff to their race.");
        setRows(null);
        setReferenceDriver(null);
        setLoading(false);
        return;
      }

      try {
        const r = await fetch(
          `/api/what-if/subsessions/${encodeURIComponent(subsessionId!)}/standings?fromLap=${fromLap}&excludePitLaps=${excludePitLaps}&driver=${encodeURIComponent(driverQuery)}`
        );
        const data = await r.json();
        if (cancelled) return;

        if (!data.ok) {
          setError(data.message ?? "Could not load standings.");
          setRows(null);
          setReferenceDriver(null);
        } else {
          setRows(data.standings ?? []);
          setReferenceDriver(data.referenceDriver ?? null);
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
  }, [subsessionId, fromLap, excludePitLaps, driverQuery]);

  function applyFilters() {
    const next = new URLSearchParams(searchParams);
    next.set("fromLap", String(Math.max(1, Math.trunc(fromLapInput) || 1)));
    next.set("driver", driverInput.trim());
    setSearchParams(next);
  }

  function toggleExcludePitLaps(checked: boolean) {
    const next = new URLSearchParams(searchParams);
    next.set("excludePitLaps", String(checked));
    setSearchParams(next);
  }

  function toggleSort(column: SortColumn) {
    if (column === sortColumn) {
      setSortAsc((v) => !v);
    } else {
      setSortColumn(column);
      setSortAsc(true);
    }
  }

  // "Position" order is exactly what the API already returned (laps
  // completed first, time as tiebreaker). "Avg lap" reorders drivers within
  // 2 laps of the reference driver's own distance by pace, since a whole-lap
  // count is quantized (a lap boundary landing just before the cutoff can
  // bank an extra lap) and can disagree with who was actually quicker -
  // drivers further than 2 laps off aren't a meaningful pace comparison
  // (very different races: an early spin, a long repair, lap traffic), so
  // they're left in their normal order at the end instead of being sorted in.
  const sortedRows = useMemo(() => {
    if (!rows) return null;
    if (sortColumn === "position") {
      return sortAsc ? rows : [...rows].reverse();
    }
    const near = rows.filter((r) => r.nearReference && r.avgLapMs !== null);
    const rest = rows.filter((r) => !(r.nearReference && r.avgLapMs !== null));
    near.sort((a, b) => (sortAsc ? 1 : -1) * ((a.avgLapMs as number) - (b.avgLapMs as number)));
    return [...near, ...rest];
  }, [rows, sortColumn, sortAsc]);

  function SortHeader({ column, label }: { column: SortColumn; label: string }) {
    const active = sortColumn === column;
    return (
      <th onClick={() => toggleSort(column)} style={{ cursor: "pointer", userSelect: "none" }} title="Click to sort">
        {label}
        {active ? (sortAsc ? " ▲" : " ▼") : ""}
      </th>
    );
  }

  return (
    <>
      <p className="whatif-hint whatif-mono">Subsession #{subsessionId}</p>

      <div className="whatif-row" style={{ marginBottom: 24 }}>
        <label className="whatif-hint" htmlFor="from-lap-input" style={{ margin: 0 }}>
          From lap
        </label>
        <input
          id="from-lap-input"
          className="whatif-input whatif-input-sm"
          type="number"
          min={1}
          max={999}
          value={fromLapInput}
          onChange={(e) => setFromLapInput(Math.max(1, Number(e.target.value) || 1))}
        />

        <input
          className="whatif-input"
          placeholder="Your driver name"
          value={driverInput}
          onChange={(e) => setDriverInput(e.target.value)}
        />

        <button className="whatif-btn" onClick={applyFilters} disabled={!driverInput.trim()}>
          Recompute
        </button>
      </div>

      <div className="whatif-row" style={{ marginTop: -14, marginBottom: 24 }}>
        <label className="whatif-hint whatif-checkbox-label" style={{ margin: 0 }}>
          <input
            type="checkbox"
            checked={excludePitLaps}
            onChange={(e) => toggleExcludePitLaps(e.target.checked)}
          />
          Ignore pit-stop laps
        </label>
      </div>

      {loading && <p className="whatif-hint">Loading…</p>}
      {error && <p className="whatif-error">{error}</p>}

      {sortedRows && referenceDriver && (
        <div className="whatif-section">
          {sortedRows.length === 0 ? (
            <p className="whatif-hint">No drivers found for this subsession.</p>
          ) : (
            <>
              <p className="whatif-hint">
                Anchored to the exact moment <strong>{referenceDriver.driverName}</strong> reached lap {fromLap} -
                every driver below is compared from that same real moment, not from their own lap {fromLap}. Sort by
                Pos for finishing order (laps completed first, then time), or by Avg lap for pace alone — a whole-lap
                count can bank an extra lap right at the cutoff boundary, so the two don't always agree. Avg-lap
                sorting only reorders drivers within 2 laps of {referenceDriver.driverName}'s own distance; anyone
                further off stays at the end, since their race in this window isn't really comparable.
              </p>
              <div className="whatif-table-wrap">
                <table className="whatif-table">
                  <thead>
                    <tr>
                      <SortHeader column="position" label="Pos" />
                      <th>Driver</th>
                      <th>Time since the cutoff</th>
                      <SortHeader column="avgLap" label="Avg lap" />
                      <th>Gap</th>
                      <th>Laps used</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map((r) => (
                      <tr
                        key={r.custId}
                        style={r.custId === referenceDriver.custId ? { background: "#eff6ff" } : undefined}
                      >
                        <td>{r.position ?? "—"}</td>
                        <td>
                          {r.driverName}
                          {r.custId === referenceDriver.custId && <span className="whatif-muted"> ★</span>}
                        </td>
                        <td>
                          {r.status === "classified" && r.totalTimeMs !== null ? (
                            <span className="whatif-mono">{formatMs(r.totalTimeMs)}</span>
                          ) : (
                            <span className="whatif-muted" title={statusLabel(r)}>
                              {r.status === "dnf_before_cutoff" ? "DNF" : "No time"}
                            </span>
                          )}
                          {r.partial && (
                            <span
                              className="whatif-error"
                              title="Some laps in this range had no recorded time (invalidated/out laps) and were excluded from the total."
                              style={{ marginLeft: 4, cursor: "help" }}
                            >
                              ⚠
                            </span>
                          )}
                          {r.pitLapsEstimated > 0 && (
                            <span
                              className="whatif-muted"
                              title={`${r.pitLapsEstimated} pit lap(s) in this range had their time replaced with this driver's average pace, so the pit stop itself doesn't inflate or shrink the total.`}
                              style={{ marginLeft: 4, cursor: "help" }}
                            >
                              ≈
                            </span>
                          )}
                        </td>
                        <td className={r.nearReference ? undefined : "whatif-muted"}>
                          {r.avgLapMs !== null ? (
                            <span className="whatif-mono" title={r.nearReference ? "" : "More than 2 laps off the reference driver's distance - not a close pace comparison."}>
                              {formatMs(r.avgLapMs)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          {r.gapMs !== null ? (
                            <span className="whatif-mono">+{formatMs(r.gapMs)}</span>
                          ) : r.status === "classified" && r.lapsDown > 0 ? (
                            <span
                              className="whatif-muted"
                              title="Completed fewer laps than the leader in this window - their total time isn't directly comparable, since it covers less distance."
                            >
                              -{r.lapsDown} lap{r.lapsDown === 1 ? "" : "s"}
                            </span>
                          ) : (
                            <span className="whatif-muted">{r.status === "classified" ? "Leader" : "—"}</span>
                          )}
                        </td>
                        <td className="whatif-muted">
                          {r.lapsUsed}/{r.lapsInRange}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
