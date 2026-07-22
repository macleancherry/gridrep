import type { ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useRacePlannerViewer } from "./useRacePlannerViewer";
import { installAuthGuard, onAuthRequired } from "./authGuard";
import "./racePlanner.css";

// Installed at module load, not inside a useEffect - a page's own data-fetching effect
// (e.g. EventsHome.tsx's on-mount series fetch) can otherwise win the race and fire before
// RacePlannerLayout's effects run (child effects commit before parent effects on the same
// mount), which would let that first request's auth_required slip past unwrapped fetch.
installAuthGuard();

type Theme = "light" | "dark";
const THEME_STORAGE_KEY = "rp-theme";

function getInitialTheme(): Theme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/**
 * Coordinator navigation rebuild (2026-07-22): the sidebar collapses to the four top-level
 * jobs a coordinator actually has - Teams, Race Weekends, Plans, Live. Everything that used
 * to be its own always-visible pipeline item (Conditions/Lineup/Availability/Stints/Plan)
 * now lives inside a specific Car Entry's own checklist (RaceWeekendPage.tsx) or is reached
 * via in-page links once a plan is already in context - never a standalone nav item a
 * context-less viewer has to make sense of up front.
 */
function buildNavItems() {
  return [
    {
      to: "/race-planner/team",
      end: true,
      label: "Teams",
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
      to: "/race-planner/weekend",
      end: true,
      label: "Race Weekends",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
          <rect x="3" y="4" width="18" height="16" rx="1.5" />
          <path d="M3 9h18M8 4v5" />
        </svg>
      ),
    },
    {
      to: "/race-planner/plans",
      end: true,
      label: "Plans",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
          <path d="M7 3h8l4 4v14H7z" />
          <path d="M15 3v4h4M9 12h6M9 16h6" />
        </svg>
      ),
    },
    {
      to: "/race-planner/live",
      end: true,
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
  const [needsReauth, setNeedsReauth] = useState(false);
  const viewer = useRacePlannerViewer();
  const location = useLocation();
  const navigate = useNavigate();
  const navItems = buildNavItems();

  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  // A dead iRacing connection (token refresh failing server-side, e.g. iRacing rotated or
  // revoked it) is a different situation from being signed out of gridrep entirely - the
  // gridrep session (viewer.verified) stays perfectly valid, so the sign-in gate below never
  // fires for this. installAuthGuard() catches it centrally across every API call instead of
  // needing each page to check for it itself.
  useEffect(() => onAuthRequired(() => setNeedsReauth(true)), []);

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
  // Unlike before, signing in is never automatic: a first-time (or signed-out) visitor sees
  // a real welcome screen explaining what this app is and does, with an explicit "Connect
  // iRacing" button - clicking it is a full navigation (not client-side routing) since
  // sign-in is a real OAuth round-trip; verifyHref already carries the current path through
  // returnTo so the visitor lands back exactly where they started once signed in.
  if (!viewer.loading && !viewer.verified) {
    return (
      <div className="rp-shell" data-theme={theme}>
        <div className="rp-gate">
          <div className="rp-mark" style={{ margin: "0 auto 16px" }}>
            RP
          </div>
          <h1 className="rp-welcome-title" style={{ marginBottom: 8 }}>
            Welcome to GridRep Race Planner
          </h1>
          <p className="rp-section-sub" style={{ maxWidth: 440, marginBottom: 24 }}>
            This app uses iRacing and Garage 61 data to help you plan race weekends - build a
            team roster, schedule cars and drivers, and manage stints from practice through
            the checkered flag.
          </p>
          <a className="rp-btn rp-primary" href={verifyHref}>
            Connect iRacing →
          </a>
        </div>
      </div>
    );
  }

  // Your gridrep session is still fine (viewer.verified above) - it's specifically the
  // iRacing connection behind it that's gone stale (iRacing periodically requires
  // reconnecting, or can revoke/rotate a token outright). Re-running the same OAuth flow
  // signs the same account back in and refreshes its stored tokens - it's not a fresh
  // signup, just a reconnect - and returnTo brings them straight back to what they were
  // doing.
  if (needsReauth) {
    return (
      <div className="rp-shell" data-theme={theme}>
        <div className="rp-gate">
          <div className="rp-mark" style={{ margin: "0 auto 16px" }}>
            RP
          </div>
          <h1 className="rp-welcome-title" style={{ marginBottom: 8 }}>
            Reconnect iRacing
          </h1>
          <p className="rp-section-sub" style={{ maxWidth: 440, marginBottom: 24 }}>
            Your iRacing connection needs to be renewed — iRacing periodically requires this,
            or may have revoked the previous connection. You're still signed in to gridrep;
            reconnecting will take you right back to where you were.
          </p>
          <a className="rp-btn rp-primary" href={verifyHref}>
            Reconnect iRacing →
          </a>
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
