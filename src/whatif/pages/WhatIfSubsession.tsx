import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

type StandingRow = {
  custId: string;
  driverName: string;
  position: number | null;
  status: "classified" | "no_timed_laps" | "dnf_before_cutoff";
  totalTimeMs: number | null;
  gapMs: number | null;
  lapsDown: number;
  lapsUsed: number;
  lapsInRange: number;
  lastLapNumber: number | null;
  partial: boolean;
  pitLapsEstimated: number;
};

function formatMs(ms: number): string {
  const totalMs = Math.round(ms);
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function statusLabel(row: StandingRow): string {
  if (row.status === "dnf_before_cutoff") return "Did not reach cutoff lap";
  if (row.status === "no_timed_laps") return "No timed laps at/after cutoff";
  return "";
}

export default function WhatIfSubsession() {
  const { subsessionId } = useParams<{ subsessionId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const [fromLapInput, setFromLapInput] = useState(() => Math.max(1, Number(searchParams.get("fromLap")) || 1));
  const [driverInput, setDriverInput] = useState(() => searchParams.get("driver") ?? "");
  const [rows, setRows] = useState<StandingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fromLap = Math.max(1, Number(searchParams.get("fromLap")) || 1);
  const driverQuery = (searchParams.get("driver") ?? "").trim().toLowerCase();
  const excludePitLaps = searchParams.get("excludePitLaps") === "true";

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const r = await fetch(
          `/api/what-if/subsessions/${encodeURIComponent(subsessionId!)}/standings?fromLap=${fromLap}&excludePitLaps=${excludePitLaps}`
        );
        const data = await r.json();
        if (cancelled) return;

        if (!data.ok) {
          setError(data.message ?? "Could not load standings.");
          setRows(null);
        } else {
          setRows(data.standings ?? []);
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
  }, [subsessionId, fromLap, excludePitLaps]);

  function applyFilters() {
    const next = new URLSearchParams(searchParams);
    next.set("fromLap", String(Math.max(1, Math.trunc(fromLapInput) || 1)));
    if (driverInput.trim()) next.set("driver", driverInput.trim());
    else next.delete("driver");
    setSearchParams(next);
  }

  function toggleExcludePitLaps(checked: boolean) {
    const next = new URLSearchParams(searchParams);
    next.set("excludePitLaps", String(checked));
    setSearchParams(next);
  }

  const highlightedCustId = useMemo(() => {
    if (!rows || !driverQuery) return null;
    const match = rows.find((r) => r.driverName.toLowerCase().includes(driverQuery));
    return match?.custId ?? null;
  }, [rows, driverQuery]);

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
          placeholder="Driver name (optional, to highlight)"
          value={driverInput}
          onChange={(e) => setDriverInput(e.target.value)}
        />

        <button className="whatif-btn" onClick={applyFilters}>
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

      {driverQuery && !loading && !error && !highlightedCustId && (
        <p className="whatif-error">No driver matching "{searchParams.get("driver")}" found in this session.</p>
      )}

      {rows && (
        <div className="whatif-section">
          {rows.length === 0 ? (
            <p className="whatif-hint">No drivers found for this subsession.</p>
          ) : (
            <>
              <p className="whatif-hint">
                Ranked by laps completed since lap {fromLap} first, then by time — not by raw total time alone,
                which would otherwise favor whoever simply drove fewer laps (e.g. a driver who retired early).
              </p>
              <div className="whatif-table-wrap">
                <table className="whatif-table">
                  <thead>
                    <tr>
                      <th>Pos</th>
                      <th>Driver</th>
                      <th>Time from lap {fromLap}</th>
                      <th>Gap</th>
                      <th>Laps used</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.custId} style={r.custId === highlightedCustId ? { background: "#eff6ff" } : undefined}>
                        <td>{r.position ?? "—"}</td>
                        <td>
                          {r.driverName}
                          {r.custId === highlightedCustId && <span className="whatif-muted"> ★</span>}
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
