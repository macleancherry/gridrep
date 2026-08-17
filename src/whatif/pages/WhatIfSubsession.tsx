import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useLoadingMessage } from "../loadingMessages";

type StandingRow = {
  custId: string;
  driverName: string;
  position: number | null;
  status: "classified" | "no_timed_laps" | "dnf_before_cutoff";
  totalTimeMs: number | null;
  avgLapMs: number | null;
  avgLapStdDevMs: number | null;
  bestAdjustedLapMs: number | null;
  bestAdjustedStdDevMs: number | null;
  cleanLapMs: number | null;
  cleanLapStdDevMs: number | null;
  gapMs: number | null;
  lapsDown: number;
  lapsUsed: number;
  lapsInRange: number;
  lastLapNumber: number | null;
  partial: boolean;
  pitLapsEstimated: number;
  nearReference: boolean;
};

type DisplayRow = StandingRow & { metricGapMs: number | null };

type ReferenceDriver = { custId: string; driverName: string };
type OrderMode = "avgLap" | "bestAdjusted" | "cleanPace" | "laps";

const PACE_MODES: Record<Exclude<OrderMode, "laps">, { label: string; field: keyof StandingRow; name: string }> = {
  avgLap: { label: "Average lap time (recommended)", field: "avgLapMs", name: "average pace" },
  bestAdjusted: { label: "Best adjusted (fastest ~90%)", field: "bestAdjustedLapMs", name: "best-adjusted pace" },
  cleanPace: { label: "Clean pace (no incidents)", field: "cleanLapMs", name: "clean pace" },
};

function metricValue(mode: OrderMode, row: StandingRow): number | null {
  if (mode === "laps") return null;
  const value = row[PACE_MODES[mode].field];
  return typeof value === "number" ? value : null;
}

function formatMs(ms: number): string {
  const totalMs = Math.round(ms);
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function formatStdDev(ms: number): string {
  return `±${(ms / 1000).toFixed(3)}s`;
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

  const fromLap = Math.max(1, Number(searchParams.get("fromLap")) || 1);
  const driverQuery = (searchParams.get("driver") ?? "").trim();
  const excludePitLaps = searchParams.get("excludePitLaps") === "true";
  const orderParam = searchParams.get("order");
  const orderMode: OrderMode =
    orderParam === "laps" || orderParam === "bestAdjusted" || orderParam === "cleanPace" ? orderParam : "avgLap";

  const loadingMessage = useLoadingMessage(loading);

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

  function setOrderMode(mode: OrderMode) {
    const next = new URLSearchParams(searchParams);
    next.set("order", mode);
    setSearchParams(next);
  }

  // Positions are awarded from whichever ordering is active, not fixed to
  // one metric:
  //  - avgLap / bestAdjusted / cleanPace (recommended over "laps"): drivers
  //    within 2 laps of the reference driver's own distance are ranked by
  //    that pace figure - immune to a whole lap being banked or lost right
  //    at the cutoff boundary. Anyone further off (a very different race in
  //    this window - a big incident, a long pit stop, laps down) keeps its
  //    relative order at the end instead of being folded into a pace
  //    comparison that wouldn't mean anything for them.
  //  - "laps": the API's own laps-completed-then-time order, verbatim.
  const displayRows = useMemo((): DisplayRow[] | null => {
    if (!rows) return null;
    const classified = rows.filter((r) => r.status === "classified");
    const unclassified: DisplayRow[] = rows.filter((r) => r.status !== "classified").map((r) => ({ ...r, metricGapMs: null }));

    if (orderMode === "laps") {
      const withPositions = classified.map((r, i) => ({ ...r, position: i + 1, metricGapMs: null }));
      return [...withPositions, ...unclassified];
    }

    const near = classified.filter((r) => r.nearReference && metricValue(orderMode, r) !== null);
    const far = classified.filter((r) => !(r.nearReference && metricValue(orderMode, r) !== null));
    near.sort((a, b) => (metricValue(orderMode, a) as number) - (metricValue(orderMode, b) as number));
    const leadMetric = near[0] ? metricValue(orderMode, near[0]) : null;

    // The server's gapMs/lapsDown are relative to the laps-completed leader,
    // not whoever's on top by this pace metric - recompute a pace-based gap
    // (this driver's figure vs. the fastest in the near group) instead, so
    // the Gap column stays meaningful under this ordering too.
    const orderedClassified = [...near, ...far].map((r, i) => {
      const value = metricValue(orderMode, r);
      return {
        ...r,
        position: i + 1,
        metricGapMs: r.nearReference && value !== null && leadMetric !== null ? value - leadMetric : null,
      };
    });
    return [...orderedClassified, ...unclassified];
  }, [rows, orderMode]);

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

      <div className="whatif-row" style={{ marginTop: -14, marginBottom: 10 }}>
        <label className="whatif-hint whatif-checkbox-label" style={{ margin: 0 }}>
          <input
            type="checkbox"
            checked={excludePitLaps}
            onChange={(e) => toggleExcludePitLaps(e.target.checked)}
          />
          Ignore pit-stop laps
        </label>
      </div>

      <div className="whatif-row" style={{ marginBottom: 10 }}>
        <label className="whatif-hint" htmlFor="order-mode-select" style={{ margin: 0 }}>
          Order by
        </label>
        <select
          id="order-mode-select"
          className="whatif-select"
          value={orderMode}
          onChange={(e) => setOrderMode(e.target.value as OrderMode)}
        >
          <option value="avgLap">{PACE_MODES.avgLap.label}</option>
          <option value="bestAdjusted">{PACE_MODES.bestAdjusted.label}</option>
          <option value="cleanPace">{PACE_MODES.cleanPace.label}</option>
          <option value="laps">Laps completed / total time</option>
        </select>
      </div>

      {orderMode === "laps" && (
        <p className="whatif-error" style={{ marginBottom: 24 }}>
          ⚠ Not recommended: a big incident or a long pit stop in this stretch changes how many laps someone
          completed without saying anything about their pace, so this ordering can be skewed by bad luck as much as
          by speed. A pace-based ordering above is usually the fairer comparison.
        </p>
      )}

      {loading && (
        <div className="whatif-progress-wrap">
          <div className="whatif-progress-track">
            <div className="whatif-progress-fill whatif-progress-indeterminate" />
          </div>
          <p className="whatif-loading-message" style={{ marginTop: 6 }}>
            {loadingMessage}
          </p>
        </div>
      )}
      {error && <p className="whatif-error">{error}</p>}

      {displayRows && referenceDriver && (
        <div className="whatif-section">
          {displayRows.length === 0 ? (
            <p className="whatif-hint">No drivers found for this subsession.</p>
          ) : (
            <>
              <p className="whatif-hint">
                Anchored to the exact moment <strong>{referenceDriver.driverName}</strong> reached lap {fromLap} -
                every driver below is compared from that same real moment, not from their own lap {fromLap}.{" "}
                {orderMode !== "laps"
                  ? `Positions are ranked by ${PACE_MODES[orderMode].name} among drivers within 2 laps of ${referenceDriver.driverName}'s own distance; anyone further off keeps its normal order at the end, since their race in this window isn't really comparable.`
                  : "Positions are ranked by laps completed first, then total time - not by raw total time alone, which would otherwise favor whoever simply drove fewer laps (e.g. a driver who retired early)."}
              </p>
              <div className="whatif-table-wrap">
                <table className="whatif-table">
                  <thead>
                    <tr>
                      <th>Pos</th>
                      <th>Driver</th>
                      <th>Time since the cutoff</th>
                      <th>Avg lap</th>
                      <th title="Standard deviation of the laps behind Avg lap - how much lap time actually varied, in seconds. Lower means more consistent.">
                        Var <span className="whatif-muted" style={{ cursor: "help" }}>ⓘ</span>
                      </th>
                      <th title="Average of the fastest ~90% of counted laps, dropping the slowest outliers. Sortable via the Order by dropdown above.">
                        Best adj. <span className="whatif-muted" style={{ cursor: "help" }}>ⓘ</span>
                      </th>
                      <th title="Standard deviation of the laps behind Best adj. (after the slowest outliers are already dropped).">
                        Var <span className="whatif-muted" style={{ cursor: "help" }}>ⓘ</span>
                      </th>
                      <th title="Average of laps with no recorded incident, off-track, or pit stop - always excludes pit laps, regardless of the Ignore pit-stop laps checkbox. Sortable via the Order by dropdown above.">
                        Clean pace <span className="whatif-muted" style={{ cursor: "help" }}>ⓘ</span>
                      </th>
                      <th title="Standard deviation of the laps behind Clean pace.">
                        Var <span className="whatif-muted" style={{ cursor: "help" }}>ⓘ</span>
                      </th>
                      <th>Gap</th>
                      <th>Laps used</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map((r) => (
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
                            <span
                              className="whatif-mono"
                              title={r.nearReference ? "" : "More than 2 laps off the reference driver's distance - not a close pace comparison."}
                            >
                              {formatMs(r.avgLapMs)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="whatif-muted">
                          {r.avgLapStdDevMs !== null ? <span className="whatif-mono">{formatStdDev(r.avgLapStdDevMs)}</span> : "—"}
                        </td>
                        <td className={r.nearReference ? undefined : "whatif-muted"}>
                          {r.bestAdjustedLapMs !== null ? (
                            <span className="whatif-mono">{formatMs(r.bestAdjustedLapMs)}</span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="whatif-muted">
                          {r.bestAdjustedStdDevMs !== null ? (
                            <span className="whatif-mono">{formatStdDev(r.bestAdjustedStdDevMs)}</span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className={r.nearReference ? undefined : "whatif-muted"}>
                          {r.cleanLapMs !== null ? (
                            <span className="whatif-mono">{formatMs(r.cleanLapMs)}</span>
                          ) : (
                            <span title="No laps with no recorded incident/off-track (and no pit stop) in this window.">—</span>
                          )}
                        </td>
                        <td className="whatif-muted">
                          {r.cleanLapStdDevMs !== null ? <span className="whatif-mono">{formatStdDev(r.cleanLapStdDevMs)}</span> : "—"}
                        </td>
                        <td>
                          {orderMode !== "laps" ? (
                            r.metricGapMs !== null ? (
                              r.metricGapMs === 0 ? (
                                <span className="whatif-muted">Leader</span>
                              ) : (
                                <span className="whatif-mono">+{formatMs(r.metricGapMs)}/lap</span>
                              )
                            ) : r.status === "classified" && r.lapsDown > 0 ? (
                              <span
                                className="whatif-muted"
                                title="More than 2 laps off the reference driver's distance - not a close pace comparison."
                              >
                                -{r.lapsDown} lap{r.lapsDown === 1 ? "" : "s"}
                              </span>
                            ) : (
                              <span className="whatif-muted">—</span>
                            )
                          ) : r.gapMs !== null ? (
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
