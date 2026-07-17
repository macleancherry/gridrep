import type { ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { useRacePlannerViewer } from "./useRacePlannerViewer";
import "./racePlanner.css";

type Theme = "light" | "dark";
const THEME_STORAGE_KEY = "rp-theme";

function getInitialTheme(): Theme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

const NAV_ITEMS = [
  {
    to: "/race-planner",
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
    to: "/race-planner/conditions",
    label: "Conditions",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
      </svg>
    ),
  },
  {
    to: "/race-planner/lineup",
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
    to: "/race-planner/availability",
    label: "Availability",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3.5 2" />
      </svg>
    ),
  },
  {
    to: "/race-planner/stints",
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
    to: "/race-planner/plan",
    label: "Plan",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
        <path d="M7 3h8l4 4v14H7z" />
        <path d="M15 3v4h4M9 12h6M9 16h6" />
      </svg>
    ),
  },
  {
    to: "/race-planner/live",
    label: "Live",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
      </svg>
    ),
  },
];

export default function RacePlannerLayout({
  children,
  contextBar,
}: {
  children: ReactNode;
  /** Event/plan-scoped header content (title, badges) - supplied by pages that have a selected plan. */
  contextBar?: ReactNode;
}) {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const viewer = useRacePlannerViewer();
  const location = useLocation();

  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const verifyHref = `/api/auth/start?returnTo=${encodeURIComponent(location.pathname + location.search)}`;

  return (
    <div className="rp-shell" data-theme={theme}>
      <div className="rp-layout">
        <div className="rp-sidebar">
          <NavLink to="/race-planner" className="rp-mark" aria-label="Race Planner home">
            RP
          </NavLink>
          <div className="rp-navstack">
            {NAV_ITEMS.map((item) => (
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
            ) : viewer.verified ? (
              <span>
                Signed in as <strong>{viewer.user.name}</strong>
              </span>
            ) : (
              <a href={verifyHref} className="rp-viewer-link">
                Sign in with iRacing →
              </a>
            )}
          </div>
          {contextBar && <div className="rp-ctxbar">{contextBar}</div>}
          <div className="rp-content">{children}</div>
        </div>
      </div>
    </div>
  );
}
