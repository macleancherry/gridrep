import { useEffect, useState, type ReactElement } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ConditionPreferencesEditor, AvailabilityTemplateEditor, FavoriteCarsEditor } from "../ProfileFieldEditors";

type Category = "racing_mode" | "discipline" | "format";

type CardDef = { value: string; title: string; description: string; icon: ReactElement };

const ICON_PROPS = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6 } as const;

const RACING_MODE_CARDS: CardDef[] = [
  {
    value: "solo",
    title: "Solo",
    description: "You drive alone — single-driver races and time trials.",
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="12" cy="8" r="3.4" />
        <path d="M4 20c0-4.4 3.6-7 8-7s8 2.6 8 7" />
      </svg>
    ),
  },
  {
    value: "team",
    title: "Team",
    description: "You share a car with teammates — endurance and multi-driver events.",
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="8.5" cy="8" r="3" />
        <path d="M2.5 20c0-3.8 2.7-6 6-6s6 2.2 6 6" />
        <circle cx="17" cy="9" r="2.4" />
        <path d="M14.5 15.5c2.7.3 4.5 2 4.5 5.5" />
      </svg>
    ),
  },
];

const DISCIPLINE_CARDS: CardDef[] = [
  {
    value: "road",
    title: "Road",
    description: "Road courses — circuits with left and right turns.",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M6 21c0-6 2-8 2-12s-1-5-1-5" />
        <path d="M18 21c0-6-2-8-2-12s1-5 1-5" />
        <path d="M12 3v3M12 10v2M12 16v2" />
      </svg>
    ),
  },
  {
    value: "oval",
    title: "Oval",
    description: "Oval tracks — high-speed pack racing.",
    icon: (
      <svg {...ICON_PROPS}>
        <ellipse cx="12" cy="12" rx="9" ry="6" />
        <ellipse cx="12" cy="12" rx="4" ry="2" />
      </svg>
    ),
  },
  {
    value: "dirt_road",
    title: "Dirt Road",
    description: "Rallycross and off-road courses.",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M6 21c0-6 2-8 2-12s-1-5-1-5" />
        <path d="M18 21c0-6-2-8-2-12s1-5 1-5" strokeDasharray="2 2" />
        <path d="M12 3v3M12 10v2M12 16v2" strokeDasharray="1.5 1.5" />
      </svg>
    ),
  },
  {
    value: "dirt_oval",
    title: "Dirt Oval",
    description: "Dirt late models, sprint cars.",
    icon: (
      <svg {...ICON_PROPS}>
        <ellipse cx="12" cy="12" rx="9" ry="6" strokeDasharray="2 2" />
        <ellipse cx="12" cy="12" rx="4" ry="2" />
      </svg>
    ),
  },
];

const FORMAT_CARDS: CardDef[] = [
  {
    value: "sprint",
    title: "Sprint",
    description: "Short standalone races, usually under an hour.",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8z" />
      </svg>
    ),
  },
  {
    value: "endurance",
    title: "Endurance",
    description: "Multi-hour team races with pit stops and driver changes.",
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3.5 2" />
      </svg>
    ),
  },
  {
    value: "special",
    title: "Special Events",
    description: "One-off endurance classics, like 24 Hours of Spa.",
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M12 2.5 14.6 9h6.9l-5.6 4.1 2.1 6.9L12 15.8 5.9 20l2.2-6.9L2.5 9h6.9z" />
      </svg>
    ),
  },
];

const SECTIONS: { category: Category; title: string; subtitle: string; cards: CardDef[] }[] = [
  { category: "racing_mode", title: "How do you race?", subtitle: "Pick everything that applies.", cards: RACING_MODE_CARDS },
  { category: "discipline", title: "What's your discipline?", subtitle: "Pick everything you race.", cards: DISCIPLINE_CARDS },
  { category: "format", title: "What do you race?", subtitle: "Pick everything that applies.", cards: FORMAT_CARDS },
];

type Preferences = Record<Category, string[]>;

const EMPTY_PREFERENCES: Preferences = { racing_mode: [], discipline: [], format: [] };

const STEP_LABELS = ["Racing preferences", "Driving preferences", "Standard availability"];

function RacingPreferencesForm({ preferences, toggle }: { preferences: Preferences; toggle: (category: Category, value: string) => void }) {
  return (
    <>
      {SECTIONS.map((section) => (
        <div key={section.category} className="rp-welcome-section">
          <h2 className="rp-welcome-section-title">{section.title}</h2>
          <p className="rp-section-sub" style={{ marginBottom: 14 }}>
            {section.subtitle}
          </p>
          <div className="rp-welcome-grid">
            {section.cards.map((card) => {
              const selected = preferences[section.category].includes(card.value);
              return (
                <button
                  key={card.value}
                  type="button"
                  className={`rp-welcome-card${selected ? " rp-welcome-card-selected" : ""}`}
                  onClick={() => toggle(section.category, card.value)}
                  aria-pressed={selected}
                >
                  <span className="rp-welcome-card-icon">{card.icon}</span>
                  <span className="rp-welcome-card-title">{card.title}</span>
                  <span className="rp-welcome-card-desc">{card.description}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

export default function WelcomePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isEdit = searchParams.get("edit") === "1";

  const [preferences, setPreferences] = useState<Preferences>(EMPTY_PREFERENCES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    fetch("/api/planner/preferences", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (data?.ok && data.preferences) setPreferences({ ...EMPTY_PREFERENCES, ...data.preferences });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function toggle(category: Category, value: string) {
    setPreferences((prev) => {
      const current = prev[category];
      const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
      return { ...prev, [category]: next };
    });
  }

  async function saveRacingPreferences(): Promise<boolean> {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/planner/preferences", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify(preferences),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) {
        setError(data.message ?? "Could not save your preferences. Please try again.");
        return false;
      }
      return true;
    } catch {
      setError("Network error. Please try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleEditSave() {
    if (await saveRacingPreferences()) navigate("/race-planner");
  }

  async function handleWizardContinue() {
    if (await saveRacingPreferences()) setStep(1);
  }

  function finishOnboarding() {
    // RacePlannerLayout's onboarding redirect gate holds a viewer snapshot fetched once on
    // mount, which a client-side navigate() won't refresh - it would immediately bounce
    // straight back here on the stale "not onboarded yet" state. A full navigation forces
    // a clean re-fetch instead.
    window.location.href = "/race-planner";
  }

  if (loading) return <p className="rp-section-sub">Loading…</p>;

  // "Edit preferences" (header link) stays a single-page form, unchanged - the step
  // wizard below is specifically the first-time onboarding sequence.
  if (isEdit) {
    return (
      <div className="rp-welcome">
        <h1 className="rp-welcome-title">Update your preferences</h1>
        <p className="rp-section-sub" style={{ marginBottom: 28 }}>
          Answer a few quick questions and we'll show you the events that actually match how you race. You can
          change these any time from the events page.
        </p>
        <RacingPreferencesForm preferences={preferences} toggle={toggle} />
        {error && <p className="rp-error">{error}</p>}
        <div className="rp-row" style={{ marginTop: 12 }}>
          <button className="rp-btn rp-primary" onClick={handleEditSave} disabled={saving}>
            {saving ? "Saving…" : "Save preferences"}
          </button>
          <button className="rp-btn" onClick={() => navigate("/race-planner")} disabled={saving}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rp-welcome">
      <h1 className="rp-welcome-title">Let's tailor GridRep to you</h1>
      <p className="rp-section-sub" style={{ marginBottom: 20 }}>
        A few quick steps and you're set — every one after the first is optional and can be filled in later from
        "My profile".
      </p>

      <div className="rp-wizard-progress">
        {STEP_LABELS.map((_, i) => (
          <div key={i} className={`rp-wizard-dot${i <= step ? " rp-active" : ""}`} />
        ))}
      </div>
      <div className="rp-wizard-step-label">
        Step {step + 1} of {STEP_LABELS.length} — {STEP_LABELS[step]}
      </div>

      {step === 0 && (
        <div className="rp-welcome-section" style={{ marginBottom: 8 }}>
          <RacingPreferencesForm preferences={preferences} toggle={toggle} />
        </div>
      )}

      {step === 1 && (
        <div className="rp-welcome-section">
          <div className="rp-card" style={{ marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>Stint preferences</h3>
            <p className="rp-section-sub">What you'd rather drive — just flags matching/clashing blocks for you later, never a hard restriction.</p>
            <ConditionPreferencesEditor />
          </div>
          <div className="rp-card">
            <h3 style={{ marginTop: 0 }}>Favorite cars</h3>
            <FavoriteCarsEditor />
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="rp-welcome-section">
          <div className="rp-card">
            <h3 style={{ marginTop: 0 }}>Your usual weekly free time</h3>
            <p className="rp-section-sub">
              In your own local time. Any race weekend's Availability page can prefill from this instead of asking
              you to re-enter it every time.
            </p>
            <AvailabilityTemplateEditor />
          </div>
        </div>
      )}

      {error && <p className="rp-error">{error}</p>}

      <div className="rp-row" style={{ marginTop: 20 }}>
        {step === 0 && (
          <button className="rp-btn rp-primary" onClick={handleWizardContinue} disabled={saving}>
            {saving ? "Saving…" : "Continue"}
          </button>
        )}
        {step === 1 && (
          <>
            <button className="rp-btn rp-primary" onClick={() => setStep(2)}>
              Continue
            </button>
            <button className="rp-btn" onClick={() => setStep(2)}>
              Skip for now
            </button>
            <button className="rp-btn" onClick={() => setStep(0)}>
              ← Back
            </button>
          </>
        )}
        {step === 2 && (
          <>
            <button className="rp-btn rp-primary" onClick={finishOnboarding}>
              Finish setup
            </button>
            <button className="rp-btn" onClick={() => setStep(1)}>
              ← Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}
