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

export default function RestartHome() {
  const navigate = useNavigate();

  const [subsessionInput, setSubsessionInput] = useState("");
  const [driverInput, setDriverInput] = useState("");
  const [fromLapInput, setFromLapInput] = useState(1);

  const [pulling, setPulling] = useState(false);
  const [pullError, setPullError] = useState<string | null>(null);
  const [pullProgress, setPullProgress] = useState<string | null>(null);

  async function compute() {
    const id = subsessionInput.trim();
    if (!id) return;

    setPulling(true);
    setPullError(null);
    setPullProgress(null);

    // Restart standings are computed from the same synced lap data Pace
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
        console.warn("restart pull: some driver lap fetches failed", allDriverFailures);
      }

      if (issues.length > 0) {
        setPullError(issues.join(" "));
        return;
      }

      const fromLap = Math.max(1, Math.trunc(fromLapInput) || 1);
      const params = new URLSearchParams({ fromLap: String(fromLap) });
      if (driverInput.trim()) params.set("driver", driverInput.trim());
      navigate(`/restart/s/${encodeURIComponent(id)}?${params.toString()}`);
    } catch {
      setPullError("Network error. Please try again.");
    } finally {
      setPulling(false);
      setPullProgress(null);
    }
  }

  return (
    <>
      <p className="restart-hint">
        Enter a subsession, and recompute finishing positions counting only the laps from a given lap number
        onward — as if the race had restarted there.
      </p>

      <section className="restart-section">
        <h2>Restart the classification</h2>
        <div className="restart-row" style={{ marginBottom: 10 }}>
          <input
            className="restart-input"
            placeholder="Subsession ID"
            value={subsessionInput}
            onChange={(e) => setSubsessionInput(e.target.value)}
          />
          <input
            className="restart-input"
            placeholder="Driver name (optional, to highlight)"
            value={driverInput}
            onChange={(e) => setDriverInput(e.target.value)}
          />
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
        </div>
        <div className="restart-row">
          <button className="restart-btn" onClick={compute} disabled={pulling || !subsessionInput.trim()}>
            {pulling ? "Pulling…" : "Compute standings"}
          </button>
        </div>
        {pullProgress && <p className="restart-hint">{pullProgress}</p>}
        {pullError && <p className="restart-error">{pullError}</p>}
      </section>
    </>
  );
}
