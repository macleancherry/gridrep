import { useEffect, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { usePlanContext } from "../PlanContext";
import ForecastChart, { type ForecastHourPoint, type ForecastPhase } from "../ForecastChart";

type EventRecord = {
  id: string;
  name: string;
  track_name: string | null;
  scheduled_start_time: string | null;
  series_name: string | null;
  min_fuel_fill_pct: number | null;
  max_fuel_fill_pct: number | null;
  min_tire_sets: number | null;
  max_tire_sets: number | null;
};

/**
 * Pit-stop ruleset guess - the Data API has no queryable field for this (checked
 * exhaustively: series/seasons, series/get, series/assets, and the full /data/doc
 * endpoint catalog - no "rules" category exists anywhere). Matched by name against
 * iRacing's own Season 3 release notes (boxthislap.org/iracing-2026-season-3-release-notes,
 * user-supplied), never asserted as confirmed data - only used to pre-fill a still-fully-
 * editable form.
 */
function guessPitRuleset(seriesName: string | null | undefined): { simultaneousFuelTyres: boolean; note: string } | null {
  if (!seriesName) return null;
  const name = seriesName.toLowerCase();

  const IMSA = ["imsa", "bmw m2 cup", "watkins glen 6 hour", "6 hours of road america", "petit le mans"];
  const NEC = ["nürburgring endurance", "nurburgring endurance", "nec"];
  const DTM = ["dtm"];

  if (IMSA.some((k) => name.includes(k))) {
    return { simultaneousFuelTyres: true, note: "Guessed from iRacing's IMSA ruleset for this event — confirm with your team." };
  }
  if (NEC.some((k) => name.includes(k))) {
    return {
      simultaneousFuelTyres: true,
      note: "Guessed from iRacing's Nürburgring Endurance ruleset (simultaneous, slower fuel rate) — confirm with your team.",
    };
  }
  if (DTM.some((k) => name.includes(k))) {
    return {
      simultaneousFuelTyres: true,
      note: "Guessed from iRacing's DTM ruleset (simultaneous, faster tyre changes) — confirm with your team.",
    };
  }

  return null;
}

type ConditionProfile = {
  id: string;
  label: string;
  windowStartMin: number | null;
  windowEndMin: number | null;
  trackTempMin: number | null;
  trackTempMax: number | null;
  airTempMin: number | null;
  airTempMax: number | null;
  trackState: string | null;
  precipPct: number | null;
  wind: string | null;
  source: "manual" | "iracing_data_api";
  submittedAt: string;
};

type PlanSummary = { id: string; name: string };

type PitRules = {
  tyreChangeIntervalStints: number | null;
  simultaneousFuelTyres: boolean;
  basePitTimeSeconds: number;
  sequentialTimePenaltySeconds: number;
  source: "preset" | "manual" | "derived";
  submittedAt: string;
  flaggedAsOutdated: boolean;
};

function sourceLabel(source: ConditionProfile["source"]): string {
  return source === "iracing_data_api" ? "Real forecast" : "Manual entry";
}

const emptyForm = {
  label: "",
  windowStartMin: "",
  windowEndMin: "",
  trackTempMin: "",
  trackTempMax: "",
  airTempMin: "",
  airTempMax: "",
  trackState: "",
  precipPct: "",
  wind: "",
};

// iRacing's own stated global default is sequential (Season 3 release notes) - only
// overridden to simultaneous when guessPitRuleset() matches a known ruleset by name.
const emptyPitRulesForm = {
  tyreChangeIntervalStints: "",
  simultaneousFuelTyres: "false",
  basePitTimeSeconds: "55",
  sequentialTimePenaltySeconds: "0",
};

export default function ConditionsPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const [searchParams] = useSearchParams();
  const planIdFromQuery = searchParams.get("planId");
  const { setContext } = usePlanContext();

  const [event, setEvent] = useState<EventRecord | null>(null);
  const [profiles, setProfiles] = useState<ConditionProfile[]>([]);
  const [forecastHours, setForecastHours] = useState<ForecastHourPoint[]>([]);
  const [refreshingForecast, setRefreshingForecast] = useState(false);
  const [forecastRefreshMessage, setForecastRefreshMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [pitRules, setPitRules] = useState<PitRules | null>(null);
  const [pitRulesForm, setPitRulesForm] = useState(emptyPitRulesForm);
  const [showPitRulesForm, setShowPitRulesForm] = useState(false);
  const [savingPitRules, setSavingPitRules] = useState(false);
  const [pitRulesGuessNote, setPitRulesGuessNote] = useState<string | null>(null);

  // Selecting a session normally arrives here with ?planId= already set. A bookmarked or
  // shared /conditions/:eventId link without one falls back to resolving the viewer's own
  // plan(s) for this event - exactly one -> use it, none -> offer to start one, more than
  // one -> let them pick rather than guessing which.
  const [myPlans, setMyPlans] = useState<PlanSummary[] | null>(null);
  const [creatingPlan, setCreatingPlan] = useState(false);

  async function load() {
    if (!eventId) return;
    setLoading(true);
    setError(null);
    try {
      const requests = [
        fetch(`/api/planner/events/${encodeURIComponent(eventId)}`, { credentials: "include" }),
        fetch(`/api/planner/events/${encodeURIComponent(eventId)}/conditions`, { credentials: "include" }),
      ];
      if (!planIdFromQuery) requests.push(fetch(`/api/planner/events/${encodeURIComponent(eventId)}/race-plans`, { credentials: "include" }));

      const pitRulesRequest = fetch(`/api/planner/events/${encodeURIComponent(eventId)}/pit-rules`, { credentials: "include" });
      const forecastHoursRequest = fetch(`/api/planner/events/${encodeURIComponent(eventId)}/forecast-hours`, { credentials: "include" });

      const [eventRes, profilesRes, plansRes] = await Promise.all(requests);
      const eventData = await eventRes.json().catch(() => ({}));
      const profilesData = await profilesRes.json().catch(() => ({}));

      if (!eventRes.ok || !eventData.ok) {
        setError(eventData.message ?? "Event not found — pick it from the events list first.");
        return;
      }

      setEvent(eventData.event);
      setProfiles(profilesData.profiles ?? []);

      try {
        const forecastHoursRes = await forecastHoursRequest;
        const forecastHoursData = await forecastHoursRes.json().catch(() => ({}));
        setForecastHours(forecastHoursRes.ok && forecastHoursData.ok ? forecastHoursData.hours ?? [] : []);
      } catch {
        setForecastHours([]);
      }

      if (plansRes) {
        const plansData = await plansRes.json().catch(() => ({}));
        setMyPlans(plansData.plans ?? []);
      }

      const pitRulesRes = await pitRulesRequest;
      const pitRulesData = await pitRulesRes.json().catch(() => ({}));
      if (pitRulesRes.ok && pitRulesData.ok) setPitRules(pitRulesData.rules ?? null);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  async function startPlan() {
    if (!eventId) return;
    setCreatingPlan(true);
    setError(null);
    try {
      const r = await fetch(`/api/planner/race-plans`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ eventId }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setError(data.message ?? "Could not start a plan for this event.");
        return;
      }
      setMyPlans([{ id: data.plan.id, name: data.plan.name }]);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setCreatingPlan(false);
    }
  }

  async function refreshForecastChart() {
    if (!eventId) return;
    setRefreshingForecast(true);
    setForecastRefreshMessage(null);
    try {
      const r = await fetch(`/api/planner/events/${encodeURIComponent(eventId)}/forecast-hours/refresh`, {
        method: "POST",
        credentials: "include",
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setForecastRefreshMessage(data.message ?? "Could not fetch the forecast chart.");
        return;
      }
      if (data.hoursInserted > 0) {
        const hoursRes = await fetch(`/api/planner/events/${encodeURIComponent(eventId)}/forecast-hours`, { credentials: "include" });
        const hoursData = await hoursRes.json().catch(() => ({}));
        setForecastHours(hoursRes.ok && hoursData.ok ? hoursData.hours ?? [] : []);
      } else {
        setForecastRefreshMessage(data.message ?? "No forecast available from iRacing for this event.");
      }
    } catch {
      setForecastRefreshMessage("Network error. Please try again.");
    } finally {
      setRefreshingForecast(false);
    }
  }

  const resolvedPlanId = planIdFromQuery ?? (myPlans?.length === 1 ? myPlans[0].id : null);

  useEffect(() => {
    setContext({ eventId: eventId ?? null, planId: resolvedPlanId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, resolvedPlanId]);

  async function saveProfile() {
    if (!eventId || !form.label.trim()) return;
    setSaving(true);
    setError(null);

    const toNum = (v: string) => (v.trim() === "" ? undefined : Number(v));

    try {
      const r = await fetch(`/api/planner/events/${encodeURIComponent(eventId)}/conditions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          label: form.label.trim(),
          windowStartMin: toNum(form.windowStartMin),
          windowEndMin: toNum(form.windowEndMin),
          trackTempMin: toNum(form.trackTempMin),
          trackTempMax: toNum(form.trackTempMax),
          airTempMin: toNum(form.airTempMin),
          airTempMax: toNum(form.airTempMax),
          trackState: form.trackState.trim() || undefined,
          precipPct: toNum(form.precipPct),
          wind: form.wind.trim() || undefined,
          source: "manual",
        }),
      });
      const data = await r.json().catch(() => ({}));

      if (!r.ok || !data.ok) {
        setError(data.message ?? "Could not save this condition profile.");
        return;
      }

      setForm(emptyForm);
      setShowForm(false);
      await load();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function openPitRulesForm() {
    if (pitRules) {
      setPitRulesForm({
        tyreChangeIntervalStints: pitRules.tyreChangeIntervalStints !== null ? String(pitRules.tyreChangeIntervalStints) : "",
        simultaneousFuelTyres: String(pitRules.simultaneousFuelTyres),
        basePitTimeSeconds: String(pitRules.basePitTimeSeconds),
        sequentialTimePenaltySeconds: String(pitRules.sequentialTimePenaltySeconds),
      });
      setPitRulesGuessNote(null);
    } else {
      const guess = guessPitRuleset(event?.series_name);
      setPitRulesForm(guess ? { ...emptyPitRulesForm, simultaneousFuelTyres: String(guess.simultaneousFuelTyres) } : emptyPitRulesForm);
      setPitRulesGuessNote(guess?.note ?? null);
    }
    setShowPitRulesForm(true);
  }

  async function savePitRules() {
    if (!eventId) return;
    setSavingPitRules(true);
    setError(null);
    try {
      const r = await fetch(`/api/planner/events/${encodeURIComponent(eventId)}/pit-rules`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          tyreChangeIntervalStints: pitRulesForm.tyreChangeIntervalStints.trim() === "" ? null : Number(pitRulesForm.tyreChangeIntervalStints),
          simultaneousFuelTyres: pitRulesForm.simultaneousFuelTyres === "true",
          basePitTimeSeconds: Number(pitRulesForm.basePitTimeSeconds),
          sequentialTimePenaltySeconds: Number(pitRulesForm.sequentialTimePenaltySeconds),
          source: "manual",
        }),
      });
      const data = await r.json().catch(() => ({}));

      if (!r.ok || !data.ok) {
        setError(data.message ?? "Could not save pit rules.");
        return;
      }

      setShowPitRulesForm(false);
      await load();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSavingPitRules(false);
    }
  }

  async function flagPitRulesOutdated() {
    if (!eventId) return;
    await fetch(`/api/planner/events/${encodeURIComponent(eventId)}/pit-rules/flag-outdated`, {
      method: "POST",
      credentials: "include",
    });
    await load();
  }

  // Practice/Qualifying/Warmup profiles are stored with a race-start-relative negative
  // offset (see plannerIracing.ts's derivePreRacePhaseProfiles) - everything else (the
  // race's own Day/Dusk/Night/Dawn breakdown, or a manually-entered profile with no
  // offset at all) renders in the existing single list, unchanged.
  const preRaceProfiles = profiles.filter((p) => p.windowStartMin !== null && p.windowStartMin < 0);
  const raceProfiles = profiles.filter((p) => !(p.windowStartMin !== null && p.windowStartMin < 0));

  // Manual entry is a fallback for events iRacing has no forecast for - once a real
  // forecast exists, adding more profiles by hand alongside it is just clutter, not a
  // real workflow anyone uses.
  const hasRealForecast = profiles.some((p) => p.source === "iracing_data_api");

  // Practice/Qualifying/Warmup phase boundaries come straight off those same pre-race
  // profiles (already race-start-relative) - Race is synthesized from the forecast's own
  // last hour rather than needing race duration stored anywhere new. Explicitly matched
  // by label, not just "starts before 0" - a Day/Night bucket can also start before race
  // start (it's not session-phase-aligned) and isn't a phase to show on the ribbon.
  const SESSION_PHASE_LABELS = new Set(["Practice", "Qualifying", "Warmup"]);
  const forecastPhases: ForecastPhase[] = preRaceProfiles
    .filter((p) => SESSION_PHASE_LABELS.has(p.label) && p.windowStartMin !== null && p.windowEndMin !== null)
    .map((p) => ({ label: p.label, startMin: p.windowStartMin as number, endMin: p.windowEndMin as number }));
  if (forecastHours.length > 0) {
    const maxForecastOffset = Math.max(...forecastHours.map((h) => h.timeOffsetMinutes));
    if (maxForecastOffset > 0) forecastPhases.push({ label: "Race", startMin: 0, endMin: maxForecastOffset });
  }

  function renderConditionRow(p: ConditionProfile) {
    return (
      <div className="rp-card rp-profile-row" key={p.id}>
        <div>
          <div className="rp-profile-label">{p.label}</div>
          <div className="rp-section-sub rp-mono">
            {p.trackTempMin !== null ? (
              <>
                {p.trackTempMin}–{p.trackTempMax}°C track
              </>
            ) : p.airTempMin !== null ? (
              <>
                {p.airTempMin}–{p.airTempMax}°C air
              </>
            ) : (
              "No temp data"
            )}
            {p.trackState ? ` · ${p.trackState}` : ""}
            {p.precipPct !== null ? ` · ${p.precipPct}% precip` : ""}
          </div>
          <div className="rp-text-faint" style={{ fontSize: 11, marginTop: 4 }}>
            {sourceLabel(p.source)} · {new Date(p.submittedAt).toLocaleString()}
          </div>
        </div>
      </div>
    );
  }

  if (loading) return <p className="rp-section-sub">Loading…</p>;

  if (error && !event) {
    return (
      <div>
        <h2>Conditions</h2>
        <p className="rp-error">{error}</p>
        <Link to="/race-planner" className="rp-btn" style={{ marginTop: 12 }}>
          ← Back to events
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="rp-row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
        <h2>Conditions — {event?.name}</h2>
        {resolvedPlanId ? (
          <Link to={`/race-planner/lineup/${resolvedPlanId}`} className="rp-btn rp-primary">
            Continue to lineup →
          </Link>
        ) : myPlans && myPlans.length === 0 ? (
          <button className="rp-btn rp-primary" onClick={startPlan} disabled={creatingPlan}>
            {creatingPlan ? "Starting…" : "Start a plan for this event"}
          </button>
        ) : null}
      </div>
      <p className="rp-section-sub" style={{ marginBottom: 16 }}>
        Forecast captured once, shared with every team planning this event instance.
      </p>

      {myPlans && myPlans.length > 1 && !planIdFromQuery && (
        <div className="rp-card" style={{ marginBottom: 16 }}>
          <div className="rp-profile-label" style={{ marginBottom: 8 }}>
            You have multiple plans for this event — pick one to continue:
          </div>
          <div className="rp-row" style={{ flexWrap: "wrap" }}>
            {myPlans.map((p) => (
              <Link key={p.id} to={`/race-planner/lineup/${p.id}`} className="rp-btn">
                {p.name}
              </Link>
            ))}
          </div>
        </div>
      )}

      {error && <p className="rp-error">{error}</p>}

      <ForecastChart hours={forecastHours} raceStartTime={event?.scheduled_start_time ?? null} phases={forecastPhases} />

      {!loading && forecastHours.length === 0 && profiles.some((p) => p.source === "iracing_data_api") && (
        <div className="rp-card rp-card-narrow" style={{ marginBottom: 20 }}>
          <div style={{ marginBottom: 8 }}>
            No forecast chart captured for this event yet — it was selected before this feature existed. The
            condition cards below are unaffected.
          </div>
          <button className="rp-btn rp-primary" onClick={refreshForecastChart} disabled={refreshingForecast}>
            {refreshingForecast ? "Fetching…" : "Fetch forecast chart"}
          </button>
          {forecastRefreshMessage && <p className="rp-section-sub" style={{ marginTop: 8 }}>{forecastRefreshMessage}</p>}
        </div>
      )}

      {profiles.length === 0 && !showForm && (
        <div className="rp-card rp-card-narrow" style={{ marginBottom: 16 }}>
          No condition profile yet for this event — this event doesn't have a real forecast available yet. Add one
          manually below.
        </div>
      )}

      {profiles.length > 0 && (
        <div className={preRaceProfiles.length > 0 && raceProfiles.length > 0 ? "rp-two-col" : undefined} style={{ marginBottom: 20 }}>
          {preRaceProfiles.length > 0 && (
            <div>
              <h3 style={{ fontSize: 15, marginBottom: 8 }}>Before the green flag</h3>
              <div className="rp-profile-list">{preRaceProfiles.map((p) => renderConditionRow(p))}</div>
            </div>
          )}

          {raceProfiles.length > 0 && (
            <div>
              {preRaceProfiles.length > 0 && <h3 style={{ fontSize: 15, marginBottom: 8 }}>During the race</h3>}
              <div className="rp-profile-list">{raceProfiles.map((p) => renderConditionRow(p))}</div>
            </div>
          )}
        </div>
      )}

      {hasRealForecast ? (
        <p className="rp-text-faint" style={{ fontSize: 11.5 }}>
          This event has a real forecast from iRacing, so manual condition entry is hidden — it's only needed for
          events without one.
        </p>
      ) : !showForm ? (
        <button className="rp-btn rp-primary" onClick={() => setShowForm(true)}>
          + Add condition profile
        </button>
      ) : (
        <div className="rp-card">
          <div className="rp-form-grid">
            <div className="rp-form-field" style={{ gridColumn: "1 / -1" }}>
              <label>Label</label>
              <input
                className="rp-input"
                placeholder="e.g. Day, Night, Dawn"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
              />
            </div>
            <div className="rp-form-field">
              <label>Window start (min)</label>
              <input
                className="rp-input"
                type="number"
                value={form.windowStartMin}
                onChange={(e) => setForm({ ...form, windowStartMin: e.target.value })}
              />
            </div>
            <div className="rp-form-field">
              <label>Window end (min)</label>
              <input
                className="rp-input"
                type="number"
                value={form.windowEndMin}
                onChange={(e) => setForm({ ...form, windowEndMin: e.target.value })}
              />
            </div>
            <div className="rp-form-field">
              <label>Track temp min (°C)</label>
              <input
                className="rp-input"
                type="number"
                value={form.trackTempMin}
                onChange={(e) => setForm({ ...form, trackTempMin: e.target.value })}
              />
            </div>
            <div className="rp-form-field">
              <label>Track temp max (°C)</label>
              <input
                className="rp-input"
                type="number"
                value={form.trackTempMax}
                onChange={(e) => setForm({ ...form, trackTempMax: e.target.value })}
              />
            </div>
            <div className="rp-form-field">
              <label>Air temp min (°C)</label>
              <input
                className="rp-input"
                type="number"
                value={form.airTempMin}
                onChange={(e) => setForm({ ...form, airTempMin: e.target.value })}
              />
            </div>
            <div className="rp-form-field">
              <label>Air temp max (°C)</label>
              <input
                className="rp-input"
                type="number"
                value={form.airTempMax}
                onChange={(e) => setForm({ ...form, airTempMax: e.target.value })}
              />
            </div>
            <div className="rp-form-field">
              <label>Track state</label>
              <input
                className="rp-input"
                placeholder="dry / green-damp / wet"
                value={form.trackState}
                onChange={(e) => setForm({ ...form, trackState: e.target.value })}
              />
            </div>
            <div className="rp-form-field">
              <label>Precip %</label>
              <input
                className="rp-input"
                type="number"
                value={form.precipPct}
                onChange={(e) => setForm({ ...form, precipPct: e.target.value })}
              />
            </div>
            <div className="rp-form-field">
              <label>Wind</label>
              <input
                className="rp-input"
                placeholder="8 kt NW"
                value={form.wind}
                onChange={(e) => setForm({ ...form, wind: e.target.value })}
              />
            </div>
          </div>
          <div className="rp-row">
            <button className="rp-btn rp-primary" onClick={saveProfile} disabled={saving || !form.label.trim()}>
              {saving ? "Saving…" : "Confirm & save"}
            </button>
            <button className="rp-btn" onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <h3 style={{ fontSize: 15, marginTop: 28, marginBottom: 8 }}>Pit rules</h3>
      <p className="rp-section-sub" style={{ marginBottom: 12 }}>
        Shared per event — new plans inherit their default pit-stop time from here.
      </p>

      {(event?.min_fuel_fill_pct !== null && event?.min_fuel_fill_pct !== undefined) ||
      (event?.min_tire_sets !== null && event?.min_tire_sets !== undefined) ? (
        <p className="rp-text-faint" style={{ fontSize: 11.5, marginBottom: 12 }}>
          Per iRacing's car regulations for this event —{" "}
          {event?.min_fuel_fill_pct !== null && event?.min_fuel_fill_pct !== undefined && (
            <>
              fuel fill cap {event.min_fuel_fill_pct === event.max_fuel_fill_pct ? `${event.min_fuel_fill_pct}%` : `${event.min_fuel_fill_pct}–${event.max_fuel_fill_pct}%`} (varies by car){" "}
            </>
          )}
          {event?.min_tire_sets !== null && event?.min_tire_sets !== undefined && (
            <>
              · tyre-set cap {event.min_tire_sets === event.max_tire_sets ? event.min_tire_sets : `${event.min_tire_sets}–${event.max_tire_sets}`} as reported (meaning of "0" unconfirmed — check your car's regs)
            </>
          )}
        </p>
      ) : null}

      {!showPitRulesForm && !pitRules && (
        <div className="rp-card rp-card-narrow" style={{ marginBottom: 12 }}>No pit rules set for this event yet.</div>
      )}

      {!showPitRulesForm && pitRules && (
        <div className="rp-card rp-profile-row" style={{ marginBottom: 12 }}>
          <div>
            <div className="rp-profile-label">
              {pitRules.basePitTimeSeconds}s base pit time
              {pitRules.flaggedAsOutdated && (
                <span className="rp-badge rp-amber" style={{ marginLeft: 8 }}>
                  Flagged outdated
                </span>
              )}
            </div>
            <div className="rp-section-sub rp-mono">
              {pitRules.simultaneousFuelTyres ? "Fuel + tyres simultaneous" : `Sequential · +${pitRules.sequentialTimePenaltySeconds}s`}
              {pitRules.tyreChangeIntervalStints !== null
                ? ` · Tyres every ${pitRules.tyreChangeIntervalStints} stint${pitRules.tyreChangeIntervalStints === 1 ? "" : "s"}`
                : ""}
            </div>
            <div className="rp-text-faint" style={{ fontSize: 11, marginTop: 4 }}>
              Manual entry · {new Date(pitRules.submittedAt).toLocaleString()}
            </div>
          </div>
          <div className="rp-row">
            <button className="rp-btn" onClick={openPitRulesForm}>
              Edit
            </button>
            {!pitRules.flaggedAsOutdated && (
              <button className="rp-btn" onClick={flagPitRulesOutdated}>
                Flag as outdated
              </button>
            )}
          </div>
        </div>
      )}

      {!showPitRulesForm ? (
        <button className="rp-btn rp-primary" onClick={openPitRulesForm}>
          {pitRules ? "Edit pit rules" : "+ Set pit rules"}
        </button>
      ) : (
        <div className="rp-card">
          {pitRulesGuessNote && (
            <p className="rp-text-faint" style={{ fontSize: 11.5, marginBottom: 10 }}>
              {pitRulesGuessNote}
            </p>
          )}
          <div className="rp-form-grid">
            <div className="rp-form-field">
              <label>Base pit time (s)</label>
              <input
                className="rp-input"
                type="number"
                value={pitRulesForm.basePitTimeSeconds}
                onChange={(e) => setPitRulesForm({ ...pitRulesForm, basePitTimeSeconds: e.target.value })}
              />
            </div>
            <div className="rp-form-field">
              <label>Fuel &amp; tyres</label>
              <select
                className="rp-input"
                value={pitRulesForm.simultaneousFuelTyres}
                onChange={(e) => setPitRulesForm({ ...pitRulesForm, simultaneousFuelTyres: e.target.value })}
              >
                <option value="true">Simultaneous</option>
                <option value="false">Sequential (adds a penalty)</option>
              </select>
            </div>
            {pitRulesForm.simultaneousFuelTyres === "false" && (
              <div className="rp-form-field">
                <label>Sequential penalty (s)</label>
                <input
                  className="rp-input"
                  type="number"
                  value={pitRulesForm.sequentialTimePenaltySeconds}
                  onChange={(e) => setPitRulesForm({ ...pitRulesForm, sequentialTimePenaltySeconds: e.target.value })}
                />
              </div>
            )}
            <div className="rp-form-field">
              <label>Tyre change interval (stints)</label>
              <input
                className="rp-input"
                type="number"
                placeholder="e.g. 1 = every stint"
                value={pitRulesForm.tyreChangeIntervalStints}
                onChange={(e) => setPitRulesForm({ ...pitRulesForm, tyreChangeIntervalStints: e.target.value })}
              />
            </div>
          </div>
          <div className="rp-row">
            <button className="rp-btn rp-primary" onClick={savePitRules} disabled={savingPitRules}>
              {savingPitRules ? "Saving…" : "Confirm & save"}
            </button>
            <button className="rp-btn" onClick={() => setShowPitRulesForm(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
