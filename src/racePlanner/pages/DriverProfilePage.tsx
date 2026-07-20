import { useEffect, useState } from "react";

type Pref = "prefer" | "neutral" | "avoid";
type ConditionPrefs = { nightPreference: Pref; wetPreference: Pref; startPreference: Pref };
type TemplateEntry = { dayOfWeek: number; startMinuteOfDay: number; endMinuteOfDay: number };

const PREF_LABEL: Record<Pref, string> = { prefer: "Prefer", neutral: "No preference", avoid: "Avoid" };
const PREF_COLOR: Record<Pref, string> = { prefer: "var(--rp-green)", neutral: "var(--rp-text-faint)", avoid: "var(--rp-red)" };
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function minutesToTimeInput(m: number): string {
  const h = Math.floor(m / 60)
    .toString()
    .padStart(2, "0");
  const mm = (m % 60).toString().padStart(2, "0");
  return `${h}:${mm}`;
}
function timeInputToMinutes(v: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(v);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

/**
 * Consolidated driver profile (PRD driver onboarding: condition preferences, standard
 * weekly availability, favorite cars). Condition preferences and favorite cars already
 * existed as data (driver_condition_preferences / user_preferences) but were scattered
 * across the Availability page and the onboarding wizard - this page is the "your
 * profile" home the PRD calls for. Standard availability is new: a driver's own recurring
 * weekly free-time pattern, projected onto a specific race weekend from the Availability
 * page's "Prefill from my template" action rather than re-entered every time.
 */
export default function DriverProfilePage() {
  const [conditionPrefs, setConditionPrefs] = useState<ConditionPrefs>({
    nightPreference: "neutral",
    wetPreference: "neutral",
    startPreference: "neutral",
  });
  const [template, setTemplate] = useState<TemplateEntry[]>([]);
  const [newBlock, setNewBlock] = useState<{ dayOfWeek: number; start: string; end: string }>({
    dayOfWeek: 6,
    start: "18:00",
    end: "21:00",
  });
  const [favoriteCars, setFavoriteCars] = useState<string[]>([]);
  const [newCar, setNewCar] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingCondition, setSavingCondition] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [savingCars, setSavingCars] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/planner/driver-preferences", { credentials: "include" }).then((r) => r.json()),
      fetch("/api/planner/driver-availability-template", { credentials: "include" }).then((r) => r.json()),
      fetch("/api/planner/preferences", { credentials: "include" }).then((r) => r.json()),
    ])
      .then(([condData, templateData, prefsData]) => {
        if (condData?.ok) setConditionPrefs(condData.preferences);
        if (templateData?.ok) setTemplate(templateData.template ?? []);
        if (prefsData?.ok) setFavoriteCars(prefsData.preferences?.favorite_car ?? []);
      })
      .catch(() => setError("Could not load your profile. Please try again."))
      .finally(() => setLoading(false));
  }, []);

  async function saveConditionPref(field: keyof ConditionPrefs, value: Pref) {
    const next = { ...conditionPrefs, [field]: value };
    setConditionPrefs(next);
    setSavingCondition(true);
    try {
      await fetch("/api/planner/driver-preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(next),
      });
    } finally {
      setSavingCondition(false);
    }
  }

  async function saveTemplate(next: TemplateEntry[]) {
    setTemplate(next);
    setSavingTemplate(true);
    try {
      await fetch("/api/planner/driver-availability-template", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ template: next }),
      });
    } finally {
      setSavingTemplate(false);
    }
  }

  function addTemplateBlock() {
    const start = timeInputToMinutes(newBlock.start);
    const end = timeInputToMinutes(newBlock.end);
    if (start === null || end === null || end <= start) {
      setError("Enter a valid start time before the end time.");
      return;
    }
    setError(null);
    saveTemplate([...template, { dayOfWeek: newBlock.dayOfWeek, startMinuteOfDay: start, endMinuteOfDay: end }]);
  }

  function removeTemplateBlock(index: number) {
    saveTemplate(template.filter((_, i) => i !== index));
  }

  async function saveFavoriteCars(next: string[]) {
    setFavoriteCars(next);
    setSavingCars(true);
    try {
      await fetch("/api/planner/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ favorite_car: next }),
      });
    } finally {
      setSavingCars(false);
    }
  }

  function addCar() {
    const trimmed = newCar.trim();
    if (!trimmed || favoriteCars.includes(trimmed)) return;
    setNewCar("");
    saveFavoriteCars([...favoriteCars, trimmed]);
  }

  function removeCar(car: string) {
    saveFavoriteCars(favoriteCars.filter((c) => c !== car));
  }

  if (loading) return <p className="rp-section-sub">Loading…</p>;

  return (
    <div>
      <h2>Your profile</h2>
      <p className="rp-section-sub" style={{ marginBottom: 20 }}>
        These carry across every team and race weekend you're on.
      </p>
      {error && <p className="rp-error">{error}</p>}

      <div className="rp-card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Stint preferences</h3>
        <p className="rp-section-sub">What you'd rather drive, not a hard restriction — just flags matching/clashing blocks for you.</p>
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
                    style={conditionPrefs[field] === p ? { borderColor: PREF_COLOR[p], color: PREF_COLOR[p] } : {}}
                    onClick={() => saveConditionPref(field, p)}
                    disabled={savingCondition}
                  >
                    {PREF_LABEL[p]}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="rp-card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0 }}>Standard availability</h3>
        <p className="rp-section-sub">
          Your usual weekly free time, in your own local time. Use "Prefill from my template" on any race weekend's
          Availability page instead of re-entering this every time.
        </p>
        <div className="rp-row" style={{ flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          <select
            className="rp-input"
            value={newBlock.dayOfWeek}
            onChange={(e) => setNewBlock({ ...newBlock, dayOfWeek: Number(e.target.value) })}
          >
            {DAY_NAMES.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
          <input
            className="rp-input"
            type="time"
            value={newBlock.start}
            onChange={(e) => setNewBlock({ ...newBlock, start: e.target.value })}
          />
          <span className="rp-text-faint">to</span>
          <input className="rp-input" type="time" value={newBlock.end} onChange={(e) => setNewBlock({ ...newBlock, end: e.target.value })} />
          <button className="rp-btn rp-primary" onClick={addTemplateBlock} disabled={savingTemplate}>
            Add block
          </button>
        </div>
        {template.length === 0 ? (
          <p className="rp-text-faint">No standard availability set yet.</p>
        ) : (
          <div className="rp-row" style={{ flexWrap: "wrap", gap: 6 }}>
            {template.map((b, i) => (
              <span className="rp-badge" key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {DAY_NAMES[b.dayOfWeek]} {minutesToTimeInput(b.startMinuteOfDay)}–{minutesToTimeInput(b.endMinuteOfDay)}
                <button
                  onClick={() => removeTemplateBlock(i)}
                  disabled={savingTemplate}
                  style={{ border: "none", background: "none", cursor: "pointer", color: "var(--rp-red)", padding: 0 }}
                  aria-label="Remove block"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="rp-card">
        <h3 style={{ marginTop: 0 }}>Favorite cars</h3>
        <div className="rp-row" style={{ marginBottom: 12 }}>
          <input
            className="rp-input"
            placeholder="e.g. GT3, LMP2…"
            value={newCar}
            onChange={(e) => setNewCar(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addCar()}
            style={{ minWidth: 220 }}
          />
          <button className="rp-btn rp-primary" onClick={addCar} disabled={savingCars || !newCar.trim()}>
            Add
          </button>
        </div>
        {favoriteCars.length === 0 ? (
          <p className="rp-text-faint">No favorite cars set yet.</p>
        ) : (
          <div className="rp-row" style={{ flexWrap: "wrap", gap: 6 }}>
            {favoriteCars.map((car) => (
              <span className="rp-badge" key={car} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {car}
                <button
                  onClick={() => removeCar(car)}
                  disabled={savingCars}
                  style={{ border: "none", background: "none", cursor: "pointer", color: "var(--rp-red)", padding: 0 }}
                  aria-label="Remove"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
