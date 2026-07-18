import { useEffect, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";

type EventRecord = {
  id: string;
  name: string;
  track_name: string | null;
  scheduled_start_time: string | null;
};

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
  source: "screenshot_ai" | "manual" | "iracing_data_api";
  submittedAt: string;
  wasEditedBeforeSave: boolean;
  flaggedAsOutdated: boolean;
};

type PlanSummary = { id: string; name: string };

function sourceLabel(source: ConditionProfile["source"]): string {
  if (source === "iracing_data_api") return "Real forecast";
  if (source === "screenshot_ai") return "AI-extracted";
  return "Manual entry";
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

export default function ConditionsPage() {
  const { eventId } = useParams<{ eventId: string }>();
  const [searchParams] = useSearchParams();
  const planIdFromQuery = searchParams.get("planId");

  const [event, setEvent] = useState<EventRecord | null>(null);
  const [profiles, setProfiles] = useState<ConditionProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

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

      const [eventRes, profilesRes, plansRes] = await Promise.all(requests);
      const eventData = await eventRes.json().catch(() => ({}));
      const profilesData = await profilesRes.json().catch(() => ({}));

      if (!eventRes.ok || !eventData.ok) {
        setError(eventData.message ?? "Event not found — pick it from the events list first.");
        return;
      }

      setEvent(eventData.event);
      setProfiles(profilesData.profiles ?? []);

      if (plansRes) {
        const plansData = await plansRes.json().catch(() => ({}));
        setMyPlans(plansData.plans ?? []);
      }
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

  const resolvedPlanId = planIdFromQuery ?? (myPlans?.length === 1 ? myPlans[0].id : null);

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

  async function flagOutdated(profileId: string) {
    if (!eventId) return;
    await fetch(`/api/planner/events/${encodeURIComponent(eventId)}/conditions/flag-outdated`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ profileId }),
    });
    await load();
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

      {profiles.length === 0 && !showForm && (
        <div className="rp-card" style={{ marginBottom: 16 }}>
          No condition profile yet for this event. Add one manually below, or use the screenshot capture wizard
          (coming soon — needs a Workers AI vision model picked against real forecast screenshots first).
        </div>
      )}

      {profiles.length > 0 && (
        <div className="rp-profile-list">
          {profiles.map((p) => (
            <div className="rp-card rp-profile-row" key={p.id}>
              <div>
                <div className="rp-profile-label">
                  {p.label}
                  {p.flaggedAsOutdated && (
                    <span className="rp-badge rp-amber" style={{ marginLeft: 8 }}>
                      Flagged outdated
                    </span>
                  )}
                </div>
                <div className="rp-section-sub rp-mono">
                  {p.trackTempMin ?? "?"}–{p.trackTempMax ?? "?"}°C track
                  {p.trackState ? ` · ${p.trackState}` : ""}
                  {p.precipPct !== null ? ` · ${p.precipPct}% precip` : ""}
                </div>
                <div className="rp-text-faint" style={{ fontSize: 11, marginTop: 4 }}>
                  {sourceLabel(p.source)} · {new Date(p.submittedAt).toLocaleString()}
                </div>
              </div>
              {!p.flaggedAsOutdated && (
                <button className="rp-btn" onClick={() => flagOutdated(p.id)}>
                  Flag as outdated
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!showForm ? (
        <div className="rp-row">
          <button className="rp-btn rp-primary" onClick={() => setShowForm(true)}>
            + Add condition profile
          </button>
          <button className="rp-btn" disabled title="Needs a Workers AI vision model confirmed against real screenshots first">
            Capture via screenshot (AI) — coming soon
          </button>
        </div>
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
    </div>
  );
}
