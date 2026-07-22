import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";

type Car = {
  carId: string;
  name: string;
  carName: string | null;
  eventId: string | null;
  eventName: string | null;
  trackName: string | null;
  scheduledStartTime: string | null;
  driverCount: number;
};
type RosterMember = { custId: string; driverName: string | null };
type Assignment = { carId: string; custId: string; driverName: string | null; availableMinutes: number };

/**
 * Race Weekend checklist hub (coordinator navigation rebuild, 2026-07-22): a weekend's
 * "job to be done" list of Car Entries, each one an independent checklist - pick its race,
 * add its drivers (which kicks off background pace/fuel sync for that car+track
 * combination), build its stints, then finalize/go live. Two cars in the same weekend can
 * run completely different races/sessions; each one's checklist is entirely self-contained.
 * Replaces the old form-heavy multi-car hub, reusing the same jobs-to-be-done wizard-card
 * visual language WelcomePage.tsx/HomePage.tsx already use elsewhere in this app.
 *
 * The old "pool the whole roster, suggest a balanced split across cars" feature
 * (participants + distribution) only ever made sense when every car in the weekend shares
 * one real-world race - now that a car's race is picked independently, it's kept but only
 * shown as an optional convenience when 2+ cars actually do share the same event; the
 * primary, always-available way to get drivers onto a car is the per-car "Add drivers"
 * step, which quick-adds straight from the team roster (already built into LineupPage.tsx).
 */
export default function RaceWeekendPage() {
  const { weekendId } = useParams<{ weekendId: string }>();
  const navigate = useNavigate();
  const [weekendName, setWeekendName] = useState<string>("");
  const [teamId, setTeamId] = useState<string | null>(null);
  const [cars, setCars] = useState<Car[]>([]);
  const [isCoordinator, setIsCoordinator] = useState(false);
  const [roster, setRoster] = useState<RosterMember[]>([]);
  const [participantIds, setParticipantIds] = useState<Set<string>>(new Set());
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingParticipants, setSavingParticipants] = useState(false);
  const [addingCar, setAddingCar] = useState(false);
  const [newCarName, setNewCarName] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmedMessage, setConfirmedMessage] = useState<string | null>(null);
  const [deletingWeekend, setDeletingWeekend] = useState(false);

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
        setTeamId(data.weekend.teamId ?? null);
        setCars(data.cars ?? []);
        setIsCoordinator(Boolean(data.isCoordinator));
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
    Promise.resolve()
      .then(() => {
        loadWeekend();
        loadParticipants();
      })
      .finally(() => setLoading(false));
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
        body: JSON.stringify({ name: newCarName.trim() || `Car ${cars.length + 1}` }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok && data.ok) {
        setNewCarName("");
        loadWeekend();
      }
    } finally {
      setAddingCar(false);
    }
  }

  function selectRaceFor(car: Car) {
    navigate(`/race-planner/series?planId=${encodeURIComponent(car.carId)}&weekendId=${encodeURIComponent(weekendId!)}`);
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
      setConfirmedMessage(`Saved — ${data.carsUpdated} car${data.carsUpdated === 1 ? "" : "s"} updated.`);
      loadWeekend();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setConfirming(false);
    }
  }

  async function deleteWeekend() {
    if (!weekendId) return;
    if (
      !window.confirm(
        `Delete "${weekendName}"? This removes all ${cars.length} car${cars.length === 1 ? "" : "s"}, their lineups and stints, and everyone's submitted availability for this weekend. This can't be undone.`
      )
    ) {
      return;
    }
    setDeletingWeekend(true);
    setError(null);
    try {
      const r = await fetch(`/api/planner/race-weekends/${encodeURIComponent(weekendId)}`, { method: "DELETE", credentials: "include" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setError(data.message ?? "Could not delete this race weekend.");
        return;
      }
      navigate(teamId ? `/race-planner/team/${teamId}` : "/race-planner/weekend");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setDeletingWeekend(false);
    }
  }

  if (loading) return <p className="rp-section-sub">Loading…</p>;

  const unassignedParticipants = assignments
    ? [...participantIds].filter((id) => !assignments.some((a) => a.custId === id))
    : [];

  // The pooled/suggest-split convenience only makes sense when 2+ cars genuinely share one
  // race - shown only then, since a shared availability pool has no clean meaning once
  // cars can run entirely different events.
  const eventCounts = new Map<string, number>();
  for (const car of cars) {
    if (car.eventId) eventCounts.set(car.eventId, (eventCounts.get(car.eventId) ?? 0) + 1);
  }
  const showSameRaceConvenience = [...eventCounts.values()].some((n) => n >= 2);

  return (
    <div>
      <h2>{weekendName}</h2>
      <p className="rp-section-sub" style={{ marginBottom: 16 }}>
        Work through each car below: pick its race, add its drivers, then build its stints.
      </p>
      {error && <p className="rp-error">{error}</p>}
      {confirmedMessage && <p className="rp-badge rp-green" style={{ display: "inline-block", marginBottom: 12 }}>{confirmedMessage}</p>}

      <div className="rp-event-grid" style={{ marginBottom: 20 }}>
        {cars.map((car) => (
          <div className="rp-event-card" key={car.carId}>
            <h3 className="rp-event-track">{car.name}</h3>
            {car.eventId ? (
              <>
                <div className="rp-event-meta">
                  <span>Race</span>
                  <span className="rp-mono">{car.eventName ?? car.trackName ?? "Selected"}</span>
                </div>
                {car.scheduledStartTime && (
                  <div className="rp-event-meta">
                    <span>Start</span>
                    <span className="rp-mono">{new Date(car.scheduledStartTime).toLocaleString()}</span>
                  </div>
                )}
                <div className="rp-event-meta">
                  <span>Drivers</span>
                  <span className="rp-mono">{car.driverCount}</span>
                </div>
              </>
            ) : (
              <p className="rp-text-faint" style={{ fontSize: 12.5 }}>No race selected yet.</p>
            )}

            <div className="rp-row" style={{ flexWrap: "wrap", gap: 6, marginTop: 10 }}>
              {isCoordinator && (
                <button className="rp-btn" onClick={() => selectRaceFor(car)}>
                  {car.eventId ? "Change race →" : "Select race →"}
                </button>
              )}
              {car.eventId && (
                <>
                  <Link className="rp-btn" to={`/race-planner/lineup/${car.carId}`}>
                    Add drivers →
                  </Link>
                  {car.driverCount > 0 && (
                    <>
                      <Link className="rp-btn" to={`/race-planner/stints/${car.carId}`}>
                        Stints →
                      </Link>
                      <Link className="rp-btn" to={`/race-planner/plan/${car.carId}`}>
                        Finalize →
                      </Link>
                      <Link className="rp-btn" to={`/race-planner/live/${car.carId}`}>
                        Live →
                      </Link>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {isCoordinator && (
        <div className="rp-card rp-card-narrow" style={{ marginBottom: 20 }}>
          <div className="rp-row" style={{ flexWrap: "wrap", gap: 8 }}>
            <input
              className="rp-input"
              placeholder={`Car ${cars.length + 1}`}
              value={newCarName}
              onChange={(e) => setNewCarName(e.target.value)}
              style={{ minWidth: 160 }}
            />
            <button className="rp-btn rp-primary" onClick={addCar} disabled={addingCar}>
              {addingCar ? "Adding…" : "+ Add a car"}
            </button>
          </div>
        </div>
      )}

      {showSameRaceConvenience && (
        <>
          <div className="rp-card rp-card-narrow" style={{ marginBottom: 20 }}>
            <h3 style={{ marginTop: 0 }}>These cars are entered in the same race</h3>
            <p className="rp-section-sub">
              Pool your roster here and let gridrep suggest a balanced split, instead of adding drivers to each car
              one at a time. {savingParticipants && <span className="rp-text-faint">Saving…</span>}
            </p>
            <div className="rp-row" style={{ flexWrap: "wrap", gap: 8 }}>
              {roster.map((m) => {
                const checked = participantIds.has(m.custId);
                return (
                  <label
                    key={m.custId}
                    className="rp-badge"
                    style={{ cursor: isCoordinator ? "pointer" : "default", borderColor: checked ? "var(--rp-green)" : undefined }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!isCoordinator}
                      onChange={() => toggleParticipant(m.custId)}
                      style={{ marginRight: 6 }}
                    />
                    {m.driverName ?? `Driver ${m.custId}`}
                  </label>
                );
              })}
              {roster.length === 0 && <p className="rp-text-faint">No one on this team's roster yet.</p>}
            </div>
          </div>

          <div className="rp-card rp-card-narrow" style={{ marginBottom: 20 }}>
            <h3 style={{ marginTop: 0 }}>Distribution</h3>
            {!isCoordinator ? (
              <p className="rp-text-faint">Only this team's coordinator can manage the driver split for this weekend.</p>
            ) : (
              <>
                <button className="rp-btn rp-primary" onClick={suggestDistribution} disabled={suggesting || participantIds.size === 0}>
                  {suggesting ? "Computing…" : assignments ? "Re-suggest from availability" : "Suggest a split"}
                </button>
                <p className="rp-text-faint" style={{ fontSize: 11, marginTop: 6 }}>
                  Balances by each driver's submitted availability. Doesn't know about condition preferences or
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
        </>
      )}

      {isCoordinator && (
        <div className="rp-row" style={{ marginTop: 20, justifyContent: "flex-end" }}>
          <button
            className="rp-btn"
            style={{ borderColor: "var(--rp-red)", color: "var(--rp-red)" }}
            onClick={deleteWeekend}
            disabled={deletingWeekend}
          >
            {deletingWeekend ? "Deleting…" : "Delete this race weekend"}
          </button>
        </div>
      )}
    </div>
  );
}
