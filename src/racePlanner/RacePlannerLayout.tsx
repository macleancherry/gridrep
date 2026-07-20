import type { ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useRacePlannerViewer } from "./useRacePlannerViewer";
import { usePlanContext } from "./PlanContext";
import "./racePlanner.css";

type Theme = "light" | "dark";
const THEME_STORAGE_KEY = "rp-theme";

function getInitialTheme(): Theme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/**
 * Nav targets depend on the currently-selected event/plan (Conditions needs an eventId,
 * Lineup/Availability/Stints/Plan need a planId) - built from PlanContext rather than
 * static paths, so clicking a sidebar item carries your current plan forward instead of
 * dropping it on the id-less placeholder route. Falls back to the bare path (which shows
 * a "select a session first" prompt) when nothing's selected yet.
 */
function buildNavItems(eventId: string | null, planId: string | null) {
  return [
    {
      to: "/race-planner/series",
      end: true,
      label: "Events",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
          <rect x="3" y="4" width="18" height="16" rx="1.5" />
          <path d="M3 9h18M8 4v5" />
        </svg>
      ),
    },
    {
      // A driver's actual job-to-be-done (set availability, check the roster) lives on
      // their team page, not inside the coordinator-oriented Events -> Conditions ->
      // Lineup pipeline below - this is the one item on the sidebar that's always
      // reachable regardless of role or whether a plan is currently in context, so "back
      // to my team" never depends on remembering a URL or re-searching a series.
      to: "/race-planner/team",
      end: true,
      label: "My teams",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
          <circle cx="8.5" cy="8" r="3" />
          <path d="M2.5 20c0-3.8 2.7-6 6-6s6 2.2 6 6" />
          <circle cx="17" cy="9" r="2.4" />
          <path d="M14.5 15.5c2.7.3 4.5 2 4.5 5.5" />
        </svg>
      ),
    },
    {
      to: eventId ? `/race-planner/conditions/${eventId}` : "/race-planner/conditions",
      label: "Conditions",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
        </svg>
      ),
    },
    {
      to: planId ? `/race-planner/lineup/${planId}` : "/race-planner/lineup",
      label: "Lineup",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
          <circle cx="9" cy="8" r="3" />
          <path d="M2 21c0-4 3-6 7-6s7 2 7 6" />
          <circle cx="18" cy="8" r="2.4" />
          <path d="M15.5 15.2c2.7.3 4.5 2 4.5 5.8" />
        </svg>
      ),
    },
    {
      to: planId ? `/race-planner/availability/${planId}` : "/race-planner/availability",
      label: "Availability",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3.5 2" />
        </svg>
      ),
    },
    {
      to: planId ? `/race-planner/stints/${planId}` : "/race-planner/stints",
      label: "Stints",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
          <rect x="3" y="10" width="6" height="7" />
          <rect x="9" y="6" width="6" height="11" />
          <rect x="15" y="13" width="6" height="4" />
        </svg>
      ),
    },
    {
      to: planId ? `/race-planner/plan/${planId}` : "/race-planner/plan",
      label: "Plan",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
          <path d="M7 3h8l4 4v14H7z" />
          <path d="M15 3v4h4M9 12h6M9 16h6" />
        </svg>
      ),
    },
    {
      to: planId ? `/race-planner/live/${planId}` : "/race-planner/live",
      label: "Live",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
        </svg>
      ),
    },
  ];
}

export default function RacePlannerLayout({
  children,
  contextBar,
  skipOnboardingGate,
}: {
  children: ReactNode;
  /** Event/plan-scoped header content (title, badges) - supplied by pages that have a selected plan. */
  contextBar?: ReactNode;
  /** The wizard page itself, and only the wizard page, must not redirect back to itself. */
  skipOnboardingGate?: boolean;
}) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const viewer = useRacePlannerViewer();
  const location = useLocation();
  const navigate = useNavigate();
  const { eventId, planId } = usePlanContext();
  const navItems = buildNavItems(eventId, planId);

  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  // First thing after a fresh sign-in: send a driver who hasn't answered the preference
  // wizard yet straight there, before they see anything else - "tailored from the start"
  // rather than a settings page they might never find. Carries the page they were actually
  // headed to through returnTo (same pattern as verifyHref just below) so, e.g., a driver
  // who just accepted a team invite (JoinTeamPage already navigated them to their new
  // team's page before this gate intercepts) lands back on that team once the wizard's
  // done, instead of the generic home picker.
  useEffect(() => {
    if (skipOnboardingGate) return;
    if (viewer.loading || !viewer.verified) return;
    if (!viewer.onboardingCompleted) {
      const returnTo = location.pathname + location.search;
      const suffix = returnTo && returnTo !== "/race-planner" ? `?returnTo=${encodeURIComponent(returnTo)}` : "";
      navigate(`/race-planner/welcome${suffix}`, { replace: true });
    }
  }, [skipOnboardingGate, viewer, navigate, location]);

  const verifyHref = `/api/auth/start?returnTo=${encodeURIComponent(location.pathname + location.search)}`;

  // Every /race-planner/* page requires a signed-in viewer - there's no useful anonymous
  // surface here (every page either 401s or shows nothing meaningful without a session).
  // A full navigation (not client-side routing) is required since sign-in is a real OAuth
  // round-trip; verifyHref already carries the current path through returnTo so the visitor
  // lands back exactly where they started once signed in.
  useEffect(() => {
    if (viewer.loading || viewer.verified) return;
    window.location.href = verifyHref;
  }, [viewer.loading, viewer.verified, verifyHref]);

  if (!viewer.loading && !viewer.verified) {
    return (
      <div className="rp-shell" data-theme={theme}>
        <div className="rp-gate">
          <div className="rp-mark" style={{ margin: "0 auto 16px" }}>
            RP
          </div>
          <p className="rp-section-sub">Redirecting you to sign in with iRacing…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rp-shell" data-theme={theme}>
      <div className="rp-layout">
        <div className="rp-sidebar">
          <NavLink to="/race-planner" className="rp-mark" aria-label="Race Planner home">
            RP
          </NavLink>
          <div className="rp-navstack">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `rp-navbtn${isActive ? " rp-active" : ""}`}
              >
                {item.icon}
                {item.label}
              </NavLink>
            ))}
          </div>
          <button
            className="rp-theme-toggle"
            title="Toggle light / dark mode"
            onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
          >
            {theme === "light" ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
                <circle cx="12" cy="12" r="4" />
                <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
              </svg>
            )}
          </button>
        </div>

        <div className="rp-main">
          <div className="rp-viewer-strip">
            {viewer.loading ? (
              <span className="rp-text-faint">Checking…</span>
            ) : viewer.verified && (
              <span>
                Signed in as <strong>{viewer.user.name}</strong>
                {viewer.garage61Connected ? (
                  <span className="rp-text-faint"> · Garage 61 connected</span>
                ) : (
                  <>
                    {" · "}
                    <a
                      href={`/api/auth/garage61/start?returnTo=${encodeURIComponent(
                        location.pathname + location.search
                      )}`}
                      className="rp-viewer-link"
                    >
                      Connect Garage 61 →
                    </a>
                  </>
                )}
                {" · "}
                <NavLink to="/race-planner/profile" className="rp-viewer-link">
                  My profile
                </NavLink>
                {" · "}
                <NavLink to="/race-planner/welcome?edit=1" className="rp-viewer-link">
                  Edit preferences
                </NavLink>
              </span>
            )}
          </div>
          {contextBar && <div className="rp-ctxbar">{contextBar}</div>}
          <div className="rp-content">{children}</div>
        </div>
      </div>
    </div>
  );
}
