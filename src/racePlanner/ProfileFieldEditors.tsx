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
 * Standing driver-profile fields (condition preferences, standard weekly availability,
 * favorite cars) - each owns its own load/save against its backing endpoint, so it can be
 * dropped into DriverProfilePage.tsx (edit any time) and the onboarding wizard
 * (WelcomePage.tsx, set once up front) without either page needing to know how the other
 * one persists data.
 */

export function ConditionPreferencesEditor() {
  const [prefs, setPrefs] = useState<ConditionPrefs>({ nightPreference: "neutral", wetPreference: "neutral", startPreference: "neutral" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/planner/driver-preferences", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (data?.ok) setPrefs(data.preferences);
      })
      .finally(() => setLoading(false));
  }, []);

  async function save(field: keyof ConditionPrefs, value: Pref) {
    const next = { ...prefs, [field]: value };
    setPrefs(next);
    setSaving(true);
    try {
      await fetch("/api/planner/driver-preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(next),
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="rp-section-sub">Loading…</p>;

  return (
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
                style={prefs[field] === p ? { borderColor: PREF_COLOR[p], color: PREF_COLOR[p] } : {}}
                onClick={() => save(field, p)}
                disabled={saving}
              >
                {PREF_LABEL[p]}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function AvailabilityTemplateEditor() {
  const [template, setTemplate] = useState<TemplateEntry[]>([]);
  const [newBlock, setNewBlock] = useState<{ dayOfWeek: number; start: string; end: string }>({
    dayOfWeek: 6,
    start: "18:00",
    end: "21:00",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/planner/driver-availability-template", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (data?.ok) setTemplate(data.template ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  async function saveTemplate(next: TemplateEntry[]) {
    setTemplate(next);
    setSaving(true);
    try {
      await fetch("/api/planner/driver-availability-template", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ template: next }),
      });
    } finally {
      setSaving(false);
    }
  }

  function addBlock() {
    const start = timeInputToMinutes(newBlock.start);
    const end = timeInputToMinutes(newBlock.end);
    if (start === null || end === null || end <= start) {
      setError("Enter a valid start time before the end time.");
      return;
    }
    setError(null);
    saveTemplate([...template, { dayOfWeek: newBlock.dayOfWeek, startMinuteOfDay: start, endMinuteOfDay: end }]);
  }

  function removeBlock(index: number) {
    saveTemplate(template.filter((_, i) => i !== index));
  }

  if (loading) return <p className="rp-section-sub">Loading…</p>;

  return (
    <div>
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
        <input className="rp-input" type="time" value={newBlock.start} onChange={(e) => setNewBlock({ ...newBlock, start: e.target.value })} />
        <span className="rp-text-faint">to</span>
        <input className="rp-input" type="time" value={newBlock.end} onChange={(e) => setNewBlock({ ...newBlock, end: e.target.value })} />
        <button className="rp-btn rp-primary" onClick={addBlock} disabled={saving}>
          Add block
        </button>
      </div>
      {error && <p className="rp-error">{error}</p>}
      {template.length === 0 ? (
        <p className="rp-text-faint">No standard availability set yet.</p>
      ) : (
        <div className="rp-row" style={{ flexWrap: "wrap", gap: 6 }}>
          {template.map((b, i) => (
            <span className="rp-badge" key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {DAY_NAMES[b.dayOfWeek]} {minutesToTimeInput(b.startMinuteOfDay)}–{minutesToTimeInput(b.endMinuteOfDay)}
              <button
                onClick={() => removeBlock(i)}
                disabled={saving}
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
  );
}

export function FavoriteCarsEditor() {
  const [cars, setCars] = useState<string[]>([]);
  const [newCar, setNewCar] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/planner/preferences", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (data?.ok) setCars(data.preferences?.favorite_car ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  async function saveCars(next: string[]) {
    setCars(next);
    setSaving(true);
    try {
      await fetch("/api/planner/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ favorite_car: next }),
      });
    } finally {
      setSaving(false);
    }
  }

  function addCar() {
    const trimmed = newCar.trim();
    if (!trimmed || cars.includes(trimmed)) return;
    setNewCar("");
    saveCars([...cars, trimmed]);
  }

  function removeCar(car: string) {
    saveCars(cars.filter((c) => c !== car));
  }

  if (loading) return <p className="rp-section-sub">Loading…</p>;

  return (
    <div>
      <div className="rp-row" style={{ marginBottom: 12 }}>
        <input
          className="rp-input"
          placeholder="e.g. GT3, LMP2…"
          value={newCar}
          onChange={(e) => setNewCar(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addCar()}
          style={{ minWidth: 220 }}
        />
        <button className="rp-btn rp-primary" onClick={addCar} disabled={saving || !newCar.trim()}>
          Add
        </button>
      </div>
      {cars.length === 0 ? (
        <p className="rp-text-faint">No favorite cars set yet.</p>
      ) : (
        <div className="rp-row" style={{ flexWrap: "wrap", gap: 6 }}>
          {cars.map((car) => (
            <span className="rp-badge" key={car} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {car}
              <button
                onClick={() => removeCar(car)}
                disabled={saving}
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
  );
}
