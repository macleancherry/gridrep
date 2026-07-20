import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { usePlanContext } from "../PlanContext";

type LineupDriver = { custId: string; driverName: string };

type Block = {
  blockStartOffsetMinutes: number;
  blockEndOffsetMinutes: number;
  utcStart: string;
  localStart: string;
  localEnd: string;
  condition: {
    label: string;
    trackTempMin: number | null;
    trackTempMax: number | null;
    airTempMin: number | null;
    airTempMax: number | null;
    trackState: string | null;
  } | null;
};

type OrganizerZone = { zone: string; start: string; finish: string };

type AvailabilityRow = { custId: string; driverName: string; blockStartOffsetMinutes: number; status: string };

type RosterPreference = { custId: string; nightPreference: Pref; wetPreference: Pref; startPreference: Pref };

type Status = "available" | "maybe" | "unavailable";
type Pref = "prefer" | "neutral" | "avoid";

const detectedTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const PREF_LABEL: Record<Pref, string> = { prefer: "Prefer", neutral: "No preference", avoid: "Avoid" };
const PREF_COLOR: Record<Pref, string> = { prefer: "var(--rp-green)", neutral: "var(--rp-text-faint)", avoid: "var(--rp-red)" };

function isNightBlock(condition: Block["condition"]): boolean {
  return condition?.label === "Night";
}
function isWetBlock(condition: Block["condition"]): boolean {
  return condition?.trackState === "wet";
}

type TemplateEntry = { dayOfWeek: number; startMinuteOfDay: number; endMinuteOfDay: number };

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Same day-of-week/minute-of-day resolution the backend's block generation already uses
 *  (Intl.DateTimeFormat in the target zone), done client-side here since the blocks the
 *  page already has (with real utcStart timestamps) are enough - no extra API round trip
 *  needed just to project the driver's own template onto them. */
function dayOfWeekAndMinuteInZone(isoUtc: string, timeZone: string): { dayOfWeek: number; minuteOfDay: number } {
  const ms = Date.parse(isoUtc);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(
    new Date(ms)
  );
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10) % 24;
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return { dayOfWeek: WEEKDAY_INDEX[weekday] ?? 0, minuteOfDay: hour * 60 + minute };
}

export default function AvailabilityPage() {
  const { planId } = useParams<{ planId: string }>();
  const { setContext } = usePlanContext();
  const [tab, setTab] = useState<"organizer" | "driver">("organizer");
  const [eventId, setEventId] = useState<string | null>(null);
  const [lineup, setLineup] = useState<LineupDriver[]>([]);
  const [organizerZones, setOrganizerZones] = useState<OrganizerZone[]>([]);
  const [allAvailability, setAllAvailability] = useState<AvailabilityRow[]>([]);
  const [rosterPreferences, setRosterPreferences] = useState<RosterPreference[]>([]);
  const [timeZone, setTimeZone] = useState(detectedTimeZone);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [myStatuses, setMyStatuses] = useState<Record<number, Status>>({});
  const [template, setTemplate] = useState<TemplateEntry[]>([]);
  const [myPrefs, setMyPrefs] = useState<{ nightPreference: Pref; wetPreference: Pref; startPreference: Pref }>({
    nightPreference: "neutral",
    wetPreference: "neutral",
    startPreference: "neutral",
  });
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planLoadFailed, setPlanLoadFailed] = useState(false);

  async function loadBlocks(tz: string) {
    if (!planId) return;
    const r = await fetch(`/api/planner/race-plans/${encodeURIComponent(planId)}/availability/blocks?tz=${encodeURIComponent(tz)}`, {
      credentials: "include",
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.ok) {
      setBlocks(data.blocks ?? []);
      setOrganizerZones(data.organizerZones ?? []);
    }
  }

  async function loadAvailability() {
    if (!planId) return;
    const r = await fetch(`/api/planner/race-plans/${encodeURIComponent(planId)}/availability`, { credentials: "include" });
    const data = await r.json().catch(() => ({}));
    const rows: AvailabilityRow[] = data.availability ?? [];
    setAllAvailability(rows);
    setRosterPreferences(data.preferences ?? []);
  }

  async function loadMyPrefs() {
    const r = await fetch(`/api/planner/driver-preferences`, { credentials: "include" });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.ok && data.preferences) setMyPrefs(data.preferences);
  }

  async function loadTemplate() {
    const r = await fetch(`/api/planner/driver-availability-template`, { credentials: "include" });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.ok) setTemplate(data.template ?? []);
  }

  /** Projects the driver's standard weekly availability (set on their profile page) onto
   *  this specific weekend's real blocks, in their chosen time zone. This page defaults
   *  every untouched block to "available" when saved (existing behavior, unchanged) - so
   *  prefill has to make an explicit call for every still-untouched block (available where
   *  the template covers it, unavailable where it doesn't) rather than only ever writing
   *  "available", or it would be a no-op against that same default. Never overwrites a
   *  block the driver's already explicitly clicked this session, in either direction. */
  function prefillFromTemplate() {
    if (template.length === 0) return;
    setMyStatuses((prev) => {
      const next = { ...prev };
      for (const b of blocks) {
        if (next[b.blockStartOffsetMinutes] !== undefined) continue;
        const { dayOfWeek, minuteOfDay } = dayOfWeekAndMinuteInZone(b.utcStart, timeZone);
        const covered = template.some((t) => t.dayOfWeek === dayOfWeek && minuteOfDay >= t.startMinuteOfDay && minuteOfDay < t.endMinuteOfDay);
        next[b.blockStartOffsetMinutes] = covered ? "available" : "unavailable";
      }
      return next;
    });
  }

  async function saveMyPref(field: "nightPreference" | "wetPreference" | "startPreference", value: Pref) {
    const next = { ...myPrefs, [field]: value };
    setMyPrefs(next);
    setSavingPrefs(true);
    try {
      await fetch(`/api/planner/driver-preferences`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(next),
      });
      await loadAvailability();
    } finally {
      setSavingPrefs(false);
    }
  }

  // The plan already exists by the time this page loads - created at series/session
  // select time, never lazily here.
  async function init() {
    if (!planId) return;
    setLoading(true);
    setError(null);
    try {
      const planRes = await fetch(`/api/planner/race-plans/${encodeURIComponent(planId)}`, { credentials: "include" });
      const planData = await planRes.json().catch(() => ({}));
      if (!planRes.ok || !planData.ok) {
        setError(planData.message ?? "Could not load this plan.");
        setPlanLoadFailed(true);
        return;
      }
      setLineup(planData.lineup ?? []);
      setEventId(planData.eventId ?? null);
    } catch {
      setError("Network error. Please try again.");
      setPlanLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  useEffect(() => {
    setContext({ planId: planId ?? null, eventId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId, eventId]);

  useEffect(() => {
    if (!planId) return;
    loadBlocks(timeZone);
    loadAvailability();
    loadMyPrefs();
    loadTemplate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  function setBlockStatus(offset: number, status: Status) {
    setMyStatuses({ ...myStatuses, [offset]: status });
  }

  async function saveMyAvailability() {
    if (!planId) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/planner/race-plans/${encodeURIComponent(planId)}/availability`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          timezone: timeZone,
          blocks: blocks.map((b) => ({
            blockStartOffsetMinutes: b.blockStartOffsetMinutes,
            status: myStatuses[b.blockStartOffsetMinutes] ?? "available",
          })),
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setError(data.message ?? "Could not save availability. Are you signed in?");
        return;
      }
      await loadAvailability();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="rp-section-sub">Loading…</p>;

  if (planLoadFailed) {
    return (
      <div>
        <h2>Availability &amp; scheduling</h2>
        <p className="rp-error">{error}</p>
        <Link to="/race-planner" className="rp-btn" style={{ marginTop: 12 }}>
          ← Back to series
        </Link>
      </div>
    );
  }

  const submittedCustIds = new Set(allAvailability.map((r) => r.custId));

  return (
    <div>
      <h2>Availability &amp; scheduling</h2>
      <p className="rp-section-sub" style={{ marginBottom: 16 }}>
        Confirm the start time, then each driver logs in to mark when they can drive.
      </p>
      {error && <p className="rp-error">{error}</p>}

      <div className="rp-row" style={{ marginBottom: 16, borderBottom: "1px solid var(--rp-border)" }}>
        <button
          className="rp-btn"
          style={tab === "organizer" ? { borderColor: "var(--rp-amber)", color: "var(--rp-amber)" } : {}}
          onClick={() => setTab("organizer")}
        >
          Organizer overview
        </button>
        <button
          className="rp-btn"
          style={tab === "driver" ? { borderColor: "var(--rp-amber)", color: "var(--rp-amber)" } : {}}
          onClick={() => setTab("driver")}
        >
          My availability
        </button>
      </div>

      {tab === "organizer" && (
        <div>
          <h3 style={{ fontSize: 15, marginBottom: 10 }}>Race window across the team's zones</h3>
          <div className="rp-form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", marginBottom: 20 }}>
            {organizerZones.map((z) => (
              <div className="rp-card" key={z.zone}>
                <div className="rp-form-field">
                  <label>{z.zone}</label>
                </div>
                <div className="rp-mono" style={{ fontSize: 12.5 }}>
                  <div>Start: {z.start}</div>
                  <div>Finish: {z.finish}</div>
                </div>
              </div>
            ))}
          </div>

          <h3 style={{ fontSize: 15, marginBottom: 10 }}>Roster status</h3>
          <div className="rp-profile-list">
            {lineup.length === 0 && <span className="rp-text-faint">No lineup yet — add drivers on the Lineup page.</span>}
            {lineup.map((d) => {
              const pref = rosterPreferences.find((p) => p.custId === d.custId);
              return (
                <div className="rp-row" key={d.custId} style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                  <span className="rp-badge" style={submittedCustIds.has(d.custId) ? { color: "var(--rp-green)", borderColor: "var(--rp-green)" } : { color: "var(--rp-text-faint)" }}>
                    {d.driverName} — {submittedCustIds.has(d.custId) ? "Submitted" : "Pending"}
                  </span>
                  {pref && (pref.nightPreference !== "neutral" || pref.wetPreference !== "neutral" || pref.startPreference !== "neutral") && (
                    <span className="rp-text-faint" style={{ fontSize: 11 }}>
                      {pref.nightPreference !== "neutral" && (
                        <span style={{ color: PREF_COLOR[pref.nightPreference], marginRight: 8 }}>
                          Night: {PREF_LABEL[pref.nightPreference]}
                        </span>
                      )}
                      {pref.wetPreference !== "neutral" && (
                        <span style={{ color: PREF_COLOR[pref.wetPreference], marginRight: 8 }}>Wet: {PREF_LABEL[pref.wetPreference]}</span>
                      )}
                      {pref.startPreference !== "neutral" && (
                        <span style={{ color: PREF_COLOR[pref.startPreference] }}>Start: {PREF_LABEL[pref.startPreference]}</span>
                      )}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === "driver" && (
        <div>
          <div className="rp-row" style={{ marginBottom: 12, alignItems: "flex-end" }}>
            <div className="rp-form-field">
              <label>Your time zone</label>
              <input
                className="rp-input"
                style={{ minWidth: 220 }}
                value={timeZone}
                onChange={(e) => setTimeZone(e.target.value)}
                onBlur={() => loadBlocks(timeZone)}
              />
            </div>
            {template.length > 0 && (
              <button
                className="rp-btn"
                onClick={prefillFromTemplate}
                title="Marks every block you haven't already touched: available where your standard weekly availability covers it, unavailable elsewhere"
              >
                Prefill from my template
              </button>
            )}
          </div>
          {template.length === 0 && (
            <p className="rp-text-faint" style={{ fontSize: 12, marginBottom: 12 }}>
              <Link to="/race-planner/profile">Set your standard availability</Link> to prefill blocks like this automatically next time.
            </p>
          )}

          <div className="rp-card" style={{ marginBottom: 16 }}>
            <div className="rp-form-field" style={{ marginBottom: 10 }}>
              <label>Your stint preferences</label>
            </div>
            <p className="rp-section-sub" style={{ marginBottom: 12 }}>
              Doesn't restrict what you can mark below — just flags blocks that match or clash with what you said here.
            </p>
            <div className="rp-form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
              {(
                [
                  ["nightPreference", "Night driving"],
                  ["wetPreference", "Wet conditions"],
                  ["startPreference", "Race start"],
                ] as const
              ).map(([field, label]) => (
                <div key={field}>
                  <div className="rp-text-faint" style={{ fontSize: 11, marginBottom: 4 }}>
                    {label}
                  </div>
                  <div className="rp-row">
                    {(["avoid", "neutral", "prefer"] as Pref[]).map((p) => (
                      <button
                        key={p}
                        className="rp-btn"
                        style={myPrefs[field] === p ? { borderColor: PREF_COLOR[p], color: PREF_COLOR[p] } : {}}
                        onClick={() => saveMyPref(field, p)}
                        disabled={savingPrefs}
                      >
                        {PREF_LABEL[p]}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rp-profile-list">
            {blocks.map((b) => {
              const status = myStatuses[b.blockStartOffsetMinutes] ?? "available";
              const matches: { text: string; pref: Pref }[] = [];
              if (isNightBlock(b.condition) && myPrefs.nightPreference !== "neutral") {
                matches.push({ text: "Night", pref: myPrefs.nightPreference });
              }
              if (isWetBlock(b.condition) && myPrefs.wetPreference !== "neutral") {
                matches.push({ text: "Wet", pref: myPrefs.wetPreference });
              }
              if (b.blockStartOffsetMinutes === 0 && myPrefs.startPreference !== "neutral") {
                matches.push({ text: "Race start", pref: myPrefs.startPreference });
              }
              return (
                <div className="rp-card rp-profile-row" key={b.blockStartOffsetMinutes}>
                  <div>
                    <div className="rp-mono">{b.localStart} – {b.localEnd}</div>
                    <div className="rp-text-faint" style={{ fontSize: 11 }}>
                      R+{Math.floor(b.blockStartOffsetMinutes / 60)}:{String(b.blockStartOffsetMinutes % 60).padStart(2, "0")}
                      {b.condition ? ` · ${b.condition.label}` : ""}
                      {b.condition?.trackTempMin != null
                        ? ` · ${b.condition.trackTempMin}–${b.condition.trackTempMax}°C track`
                        : b.condition?.airTempMin != null
                          ? ` · ${b.condition.airTempMin}–${b.condition.airTempMax}°C air`
                          : ""}
                    </div>
                    {matches.length > 0 && (
                      <div className="rp-row" style={{ marginTop: 4, gap: 4 }}>
                        {matches.map((m) => (
                          <span
                            key={m.text}
                            className={`rp-badge ${m.pref === "prefer" ? "rp-green" : ""}`}
                            style={m.pref === "avoid" ? { color: "var(--rp-red)", borderColor: "var(--rp-red)" } : {}}
                          >
                            {m.pref === "prefer" ? "You prefer" : "You avoid"} {m.text.toLowerCase()}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="rp-row">
                    {(["available", "maybe", "unavailable"] as Status[]).map((s) => (
                      <button
                        key={s}
                        className="rp-btn"
                        style={
                          status === s
                            ? { borderColor: s === "available" ? "var(--rp-green)" : s === "maybe" ? "var(--rp-amber)" : "var(--rp-red)", color: s === "available" ? "var(--rp-green)" : s === "maybe" ? "var(--rp-amber)" : "var(--rp-red)" }
                            : {}
                        }
                        onClick={() => setBlockStatus(b.blockStartOffsetMinutes, s)}
                      >
                        {s === "available" ? "Free" : s === "maybe" ? "Maybe" : "No"}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="rp-row" style={{ marginTop: 16, justifyContent: "flex-end" }}>
            <button className="rp-btn rp-primary" onClick={saveMyAvailability} disabled={saving}>
              {saving ? "Saving…" : "Save availability"}
            </button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        <Link to={`/race-planner/stints/${planId}`} className="rp-btn">
          ← Back to stints
        </Link>
      </div>
    </div>
  );
}
