import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

type StandingRow = {
  custId: string;
  driverName: string;
  position: number | null;
  status: "classified" | "no_timed_laps" | "dnf_before_cutoff";
  totalTimeMs: number | null;
  gapMs: number | null;
  lapsUsed: number;
  lapsInRange: number;
  lastLapNumber: number | null;
  partial: boolean;
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

export default function RestartSubsession() {
  const { subsessionId } = useParams<{ subsessionId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const [fromLapInput, setFromLapInput] = useState(() => Math.max(1, Number(searchParams.get("fromLap")) || 1));
  const [driverInput, setDriverInput] = useState(() => searchParams.get("driver") ?? "");
  const [rows, setRows] = useState<StandingRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fromLap = Math.max(1, Number(searchParams.get("fromLap")) || 1);
  const driverQuery = (searchParams.get("driver") ?? "").trim().toLowerCase();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const r = await fetch(
          `/api/restart/subsessions/${encodeURIComponent(subsessionId!)}/standings?fromLap=${fromLap}`
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
  }, [subsessionId, fromLap]);

  function applyFilters() {
    const next = new URLSearchParams(searchParams);
    next.set("fromLap", String(Math.max(1, Math.trunc(fromLapInput) || 1)));
    if (driverInput.trim()) next.set("driver", driverInput.trim());
    else next.delete("driver");
    setSearchParams(next);
  }

  const highlightedCustId = useMemo(() => {
    if (!rows || !driverQuery) return null;
    const match = rows.find((r) => r.driverName.toLowerCase().includes(driverQuery));
    return match?.custId ?? null;
  }, [rows, driverQuery]);

  return (
    <>
      <p className="restart-hint restart-mono">Subsession #{subsessionId}</p>

      <div className="restart-row" style={{ marginBottom: 24 }}>
        <label className="restart-hint" htmlFor="from-lap-input" style={{ margin: 0 }}>
          From lap
        </label>
        <input
          id="from-lap-input"
          className="restart-input restart-input-sm"
          type="number"
          min={1}
          max={999}
          value={fromLapInput}
          onChange={(e) => setFromLapInput(Math.max(1, Number(e.target.value) || 1))}
        />

        <input
          className="restart-input"
          placeholder="Driver name (optional, to highlight)"
          value={driverInput}
          onChange={(e) => setDriverInput(e.target.value)}
        />

        <button className="restart-btn" onClick={applyFilters}>
          Recompute
        </button>
      </div>

      {loading && <p className="restart-hint">Loading…</p>}
      {error && <p className="restart-error">{error}</p>}

      {driverQuery && !loading && !error && !highlightedCustId && (
        <p className="restart-error">No driver matching "{searchParams.get("driver")}" found in this session.</p>
      )}

      {rows && (
        <div className="restart-section">
          {rows.length === 0 ? (
            <p className="restart-hint">No drivers found for this subsession.</p>
          ) : (
            <div className="restart-table-wrap">
              <table className="restart-table">
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
                        {r.custId === highlightedCustId && <span className="restart-muted"> ★</span>}
                      </td>
                      <td>
                        {r.status === "classified" && r.totalTimeMs !== null ? (
                          <span className="restart-mono">{formatMs(r.totalTimeMs)}</span>
                        ) : (
                          <span className="restart-muted" title={statusLabel(r)}>
                            {r.status === "dnf_before_cutoff" ? "DNF" : "No time"}
                          </span>
                        )}
                        {r.partial && (
                          <span
                            className="restart-error"
                            title="Some laps in this range had no recorded time (invalidated/out laps) and were excluded from the total."
                            style={{ marginLeft: 4, cursor: "help" }}
                          >
                            ⚠
                          </span>
                        )}
                      </td>
                      <td>
                        {r.gapMs === null ? (
                          <span className="restart-muted">{r.status === "classified" ? "Leader" : "—"}</span>
                        ) : (
                          <span className="restart-mono">+{formatMs(r.gapMs)}</span>
                        )}
                      </td>
                      <td className="restart-muted">
                        {r.lapsUsed}/{r.lapsInRange}
                      </td>
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
