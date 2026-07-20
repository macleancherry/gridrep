import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";

type Car = { carId: string; name: string; carName: string | null };
type RosterMember = { custId: string; driverName: string | null };
type Assignment = { carId: string; custId: string; driverName: string | null; availableMinutes: number };

/**
 * Multi-car race weekend management (PRD phase 6): pick which team-roster drivers are in
 * scope for the whole weekend, then get a balanced draft split across its Car Entries
 * (plannerDistribution.ts), reviewable and moveable before confirming into each car's real
 * lineup. Coordinator-only - a driver never sees this page.
 */
export default function RaceWeekendPage() {
  const { weekendId } = useParams<{ weekendId: string }>();
  const [weekendName, setWeekendName] = useState<string>("");
  const [cars, setCars] = useState<Car[]>([]);
  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [participantIds, setParticipantIds] = useState<Set<string>>(new Set());
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingParticipants, setSavingParticipants] = useState(false);
  const [addingCar, setAddingCar] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmedMessage, setConfirmedMessage] = useState<string | null>(null);

  function loadWeekend() {
    if (!weekendId) return;
    fetch(`/api/planner/race-weekends/${encodeURIComponent(weekendId)}`, { credentials: "include" })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok || !data.ok) {
          setError(data.message ?? "Could not load this race weekend.");
          return;
        }
        setWeekendName(data.weekend.name ?? "Race weekend");
        setCars(data.cars ?? []);
      })
      .catch(() => setError("Network error. Please try again."));
  }

  function loadParticipants() {
    if (!weekendId) return;
    fetch(`/api/planner/race-weekends/${encodeURIComponent(weekendId)}/participants`, { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setRoster(data.roster ?? []);
          setParticipantIds(new Set(data.participantCustIds ?? []));
        }
      })
      .catch(() => {});
  }

  useEffect(() => {
    setLoading(true);
    Promise.resolve().then(() => {
      loadWeekend();
      loadParticipants();
    }).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekendId]);

  function toggleParticipant(custId: string) {
    const next = new Set(participantIds);
    if (next.has(custId)) next.delete(custId);
    else next.add(custId);
    setParticipantIds(next);
    saveParticipants(next);
  }

  async function saveParticipants(next: Set<string>) {
    if (!weekendId) return;
    setSavingParticipants(true);
    try {
      await fetch(`/api/planner/race-weekends/${encodeURIComponent(weekendId)}/participants`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ custIds: [...next] }),
      });
    } finally {
      setSavingParticipants(false);
    }
  }

  async function addCar() {
    if (!weekendId) return;
    setAddingCar(true);
    try {
      const r = await fetch(`/api/planner/race-weekends/${encodeURIComponent(weekendId)}/cars`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: `Car ${cars.length + 1}` }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.ok) loadWeekend();
    } finally {
      setAddingCar(false);
    }
  }

  async function suggestDistribution() {
    if (!weekendId) return;
    setSuggesting(true);
    setError(null);
    setConfirmedMessage(null);
    try {
      const r = await fetch(`/api/planner/race-weekends/${encodeURIComponent(weekendId)}/distribution`, { credentials: "include" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setError(data.message ?? "Could not compute a suggestion.");
        return;
      }
      setAssignments(data.assignments ?? []);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSuggesting(false);
    }
  }

  function moveDriver(custId: string, direction: -1 | 1) {
    if (!assignments) return;
    const idx = assignments.findIndex((a) => a.custId === custId);
    if (idx === -1) return;
    const carIds = cars.map((c) => c.carId);
    const currentCarIndex = carIds.indexOf(assignments[idx].carId);
    const nextCarIndex = currentCarIndex + direction;
    if (nextCarIndex < 0 || nextCarIndex >= carIds.length) return;
    const next = [...assignments];
    next[idx] = { ...next[idx], carId: carIds[nextCarIndex] };
    setAssignments(next);
  }

  async function confirmDistribution() {
    if (!weekendId || !assignments) return;
    setConfirming(true);
    setError(null);
    try {
      const byCarId: Record<string, string[]> = {};
      for (const car of cars) byCarId[car.carId] = [];
      for (const a of assignments) byCarId[a.carId]?.push(a.custId);

      const r = await fetch(`/api/planner/race-weekends/${encodeURIComponent(weekendId)}/distribution`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ assignments: byCarId }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setError(data.message ?? "Could not confirm the distribution.");
        return;
      }
      setConfirmedMessage(`Saved — ${data.carsUpdated} car${data.carsUpdated === 1 ? "" : "s"} updated. Open each car below to build its stints.`);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setConfirming(false);
    }
  }

  if (loading) return <p className="rp-section-sub">Loading…</p>;

  const unassignedParticipants = assignments
    ? [...participantIds].filter((id) => !assignments.some((a) => a.custId === id))
    : [];

  return (
    <div>
      <h2>{weekendName}</h2>
      <p className="rp-section-sub" style={{ marginBottom: 16 }}>
        Multiple cars for one race weekend — pick who's in scope, then get a balanced starting split you can adjust
        before confirming.
      </p>
      {error && <p className="rp-error">{error}</p>}
      {confirmedMessage && <p className="rp-badge rp-green" style={{ display: "inline-block", marginBottom: 12 }}>{confirmedMessage}</p>}

      <div className="rp-card rp-card-narrow" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Cars in this weekend</h3>
        <div className="rp-row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
          {cars.map((c) => (
            <Link key={c.carId} className="rp-btn" to={`/race-planner/lineup/${c.carId}`}>
              {c.name} →
            </Link>
          ))}
        </div>
        <button className="rp-btn" onClick={addCar} disabled={addingCar}>
          {addingCar ? "Adding…" : "+ Add another car"}
        </button>
      </div>

      <div className="rp-card rp-card-narrow" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Who's in scope this weekend</h3>
        <p className="rp-section-sub">
          Everyone selected here shares one availability grid for the whole weekend — open any car's Availability
          page to fill it in. {savingParticipants && <span className="rp-text-faint">Saving…</span>}
        </p>
        <div className="rp-row" style={{ flexWrap: "wrap", gap: 8 }}>
          {roster.map((m) => {
            const checked = participantIds.has(m.custId);
            return (
              <label key={m.custId} className="rp-badge" style={{ cursor: "pointer", borderColor: checked ? "var(--rp-green)" : undefined }}>
                <input type="checkbox" checked={checked} onChange={() => toggleParticipant(m.custId)} style={{ marginRight: 6 }} />
                {m.driverName ?? `Driver ${m.custId}`}
              </label>
            );
          })}
          {roster.length === 0 && <p className="rp-text-faint">No one on this team's roster yet.</p>}
        </div>
      </div>

      <div className="rp-card rp-card-narrow">
        <h3 style={{ marginTop: 0 }}>Distribution</h3>
        {cars.length < 2 ? (
          <p className="rp-text-faint">Add a second car above to split drivers across cars.</p>
        ) : (
          <>
            <button className="rp-btn rp-primary" onClick={suggestDistribution} disabled={suggesting || participantIds.size === 0}>
              {suggesting ? "Computing…" : assignments ? "Re-suggest from availability" : "Suggest a split"}
            </button>
            <p className="rp-text-faint" style={{ fontSize: 11, marginTop: 6 }}>
              Balances by each driver's submitted weekend availability. Doesn't know about condition preferences or
              per-block coverage — review before confirming.
            </p>

            {assignments && (
              <div style={{ marginTop: 16 }}>
                <div className="rp-form-grid" style={{ gridTemplateColumns: `repeat(${cars.length}, 1fr)`, gap: 12 }}>
                  {cars.map((car, carIndex) => (
                    <div key={car.carId} className="rp-card">
                      <div className="rp-form-field" style={{ marginBottom: 8 }}>
                        <label>{car.name}</label>
                      </div>
                      {assignments
                        .filter((a) => a.carId === car.carId)
                        .map((a) => (
                          <div className="rp-row" key={a.custId} style={{ justifyContent: "space-between", marginBottom: 6 }}>
                            <span style={{ fontSize: 13 }}>
                              {a.driverName ?? `Driver ${a.custId}`}{" "}
                              <span className="rp-text-faint" style={{ fontSize: 11 }}>
                                ({Math.round(a.availableMinutes / 60)}h available)
                              </span>
                            </span>
                            <span className="rp-row" style={{ gap: 2 }}>
                              <button
                                className="rp-btn"
                                style={{ padding: "2px 8px" }}
                                onClick={() => moveDriver(a.custId, -1)}
                                disabled={carIndex === 0}
                                aria-label="Move to previous car"
                              >
                                ←
                              </button>
                              <button
                                className="rp-btn"
                                style={{ padding: "2px 8px" }}
                                onClick={() => moveDriver(a.custId, 1)}
                                disabled={carIndex === cars.length - 1}
                                aria-label="Move to next car"
                              >
                                →
                              </button>
                            </span>
                          </div>
                        ))}
                      {assignments.filter((a) => a.carId === car.carId).length === 0 && (
                        <p className="rp-text-faint" style={{ fontSize: 12 }}>
                          No drivers assigned.
                        </p>
                      )}
                    </div>
                  ))}
                </div>

                {unassignedParticipants.length > 0 && (
                  <p className="rp-error" style={{ marginTop: 10 }}>
                    {unassignedParticipants.length} driver(s) in scope but not on this draft — more cars than
                    drivers, or the suggestion is stale. Re-run the suggestion.
                  </p>
                )}

                <button className="rp-btn rp-primary" style={{ marginTop: 12 }} onClick={confirmDistribution} disabled={confirming}>
                  {confirming ? "Saving…" : "Confirm this split"}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
