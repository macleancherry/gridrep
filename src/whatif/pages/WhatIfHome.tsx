import { useState } from "react";
import { useNavigate } from "react-router-dom";

type IngestResponse = {
  ok: boolean;
  message?: string;
  lapsIngested?: number;
  simSessionsIngested?: number;
  driversIngested?: number;
  totalJobs?: number;
  remainingJobs?: number;
  emptyLapPayloadSample?: string;
  driverFailures?: Array<{ custId: string; simsessionNumber: number; message: string }>;
};

export default function WhatIfHome() {
  const navigate = useNavigate();

  const [subsessionInput, setSubsessionInput] = useState("");
  const [driverInput, setDriverInput] = useState("");
  const [fromLapInput, setFromLapInput] = useState(1);
  const [excludePitLaps, setExcludePitLaps] = useState(false);

  const [pulling, setPulling] = useState(false);
  const [pullError, setPullError] = useState<string | null>(null);
  const [pullProgress, setPullProgress] = useState<string | null>(null);

  async function compute() {
    const id = subsessionInput.trim();
    if (!id || !driverInput.trim()) return;

    setPulling(true);
    setPullError(null);
    setPullProgress(null);

    // What If standings are computed from the same synced lap data Pace
    // uses (pace_laps), so pulling a subsession here reuses Pace's own
    // resumable sync endpoint - no separate ingestion pipeline needed.
    const MAX_BATCHES = 30;
    const allDriverFailures: Array<{ custId: string; simsessionNumber: number; message: string }> = [];
    let totalLapsIngested = 0;
    let lastData: IngestResponse | null = null;

    try {
      for (let batch = 0; batch < MAX_BATCHES; batch++) {
        const r = await fetch(`/api/pace/subsessions/${encodeURIComponent(id)}/sync`, { method: "POST" });
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data.ok) {
          setPullError(data.message ?? "Sync failed.");
          return;
        }

        lastData = data;
        totalLapsIngested += data.lapsIngested ?? 0;
        allDriverFailures.push(...(data.driverFailures ?? []));

        const remaining = data.remainingJobs ?? 0;
        if (remaining === 0) break;

        setPullProgress(
          `Pulling laps… ${totalLapsIngested} lap(s) so far, ${remaining} of ${data.totalJobs} driver/sim-session pull(s) left.`
        );
      }

      setPullProgress(null);

      const issues: string[] = [];
      if (totalLapsIngested === 0) {
        issues.push(
          `0 laps ingested (${lastData?.simSessionsIngested} sim-session(s), ${lastData?.driversIngested} driver(s) found).`
        );
      }
      if (lastData?.remainingJobs && lastData.remainingJobs > 0) {
        issues.push(
          `Stopped after ${MAX_BATCHES} batches with ${lastData.remainingJobs} pull(s) still pending — click Compute again to continue.`
        );
      }

      if (allDriverFailures.length > 0) {
        console.warn("what-if pull: some driver lap fetches failed", allDriverFailures);
      }

      if (issues.length > 0) {
        setPullError(issues.join(" "));
        return;
      }

      const fromLap = Math.max(1, Math.trunc(fromLapInput) || 1);
      const params = new URLSearchParams({
        fromLap: String(fromLap),
        excludePitLaps: String(excludePitLaps),
        driver: driverInput.trim(),
      });
      navigate(`/what-if/s/${encodeURIComponent(id)}?${params.toString()}`);
    } catch {
      setPullError("Network error. Please try again.");
    } finally {
      setPulling(false);
      setPullProgress(null);
    }
  }

  return (
    <>
      <p className="whatif-hint">
        Enter a subsession and your driver name, and recompute finishing positions from the exact real moment you
        reached a given lap — as if the race had restarted right then.
      </p>

      <section className="whatif-section">
        <h2>What if the race restarted here?</h2>
        <div className="whatif-row" style={{ marginBottom: 10 }}>
          <input
            className="whatif-input"
            placeholder="Subsession ID"
            value={subsessionInput}
            onChange={(e) => setSubsessionInput(e.target.value)}
          />
          <input
            className="whatif-input"
            placeholder="Your driver name"
            value={driverInput}
            onChange={(e) => setDriverInput(e.target.value)}
          />
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
        </div>
        <p className="whatif-hint" style={{ marginTop: -4 }}>
          Your driver name anchors the cutoff: everyone else is compared from the same real moment you started that
          lap, not from their own lap {Math.max(1, Math.trunc(fromLapInput) || 1)} — a faster driver reaches any
          given lap number sooner than a slower one, so comparing "everyone's own lap N" would unfairly credit
          drivers with more real racing time in their window just for getting there first.
        </p>
        <div className="whatif-row" style={{ marginBottom: 10 }}>
          <label className="whatif-hint whatif-checkbox-label" style={{ margin: 0 }}>
            <input
              type="checkbox"
              checked={excludePitLaps}
              onChange={(e) => setExcludePitLaps(e.target.checked)}
            />
            Ignore pit-stop laps
          </label>
        </div>
        <p className="whatif-hint" style={{ marginTop: -4 }}>
          Drivers don't all pit on the same lap, so counting from a fixed lap can catch one driver's pit stop and
          not another's, making that driver look artificially slower. Check this to replace each caught pit lap's
          time with that driver's own average pace instead — the stop no longer skews the total, but everyone's
          total still covers the same number of laps.
        </p>
        <div className="whatif-row">
          <button
            className="whatif-btn"
            onClick={compute}
            disabled={pulling || !subsessionInput.trim() || !driverInput.trim()}
          >
            {pulling ? "Pulling…" : "Compute standings"}
          </button>
        </div>
        {pullProgress && <p className="whatif-hint">{pullProgress}</p>}
        {pullError && <p className="whatif-error">{pullError}</p>}
      </section>
    </>
  );
}
