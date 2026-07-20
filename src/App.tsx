import { useEffect, useRef, useState } from "react";
import { Routes, Route, Link, useLocation } from "react-router-dom";
import Home from "./pages/Home";
import Driver from "./pages/Driver";
import Session from "./pages/Session";
import Leaderboard from "./pages/Leaderboard";
import About from "./pages/About";
import Privacy from "./pages/Privacy";
import PaceLayout from "./pace/PaceLayout";
import PaceHome from "./pace/pages/PaceHome";
import PaceSubsession from "./pace/pages/PaceSubsession";
import RacePlannerLayout from "./racePlanner/RacePlannerLayout";
import { PlanContextProvider } from "./racePlanner/PlanContext";
import WelcomePage from "./racePlanner/pages/WelcomePage";
import EventsHome from "./racePlanner/pages/EventsHome";
import SeriesSessionsPage from "./racePlanner/pages/SeriesSessionsPage";
import ConditionsPage from "./racePlanner/pages/ConditionsPage";
import LineupPage from "./racePlanner/pages/LineupPage";
import StintsPage from "./racePlanner/pages/StintsPage";
import AvailabilityPage from "./racePlanner/pages/AvailabilityPage";
import PlanSummaryPage from "./racePlanner/pages/PlanSummaryPage";
import LivePage from "./racePlanner/pages/LivePage";
import PlaceholderPage from "./racePlanner/pages/PlaceholderPage";
import TeamListPage from "./racePlanner/pages/TeamListPage";
import TeamPage from "./racePlanner/pages/TeamPage";
import JoinTeamPage from "./racePlanner/pages/JoinTeamPage";
import DriverProfilePage from "./racePlanner/pages/DriverProfilePage";
import HomePage from "./racePlanner/pages/HomePage";

const AUTH_BASE = "https://gridrep.gg";

type ViewerState =
  | { loading: true; verified: false; user?: undefined }
  | { loading: false; verified: false; user?: undefined }
  | { loading: false; verified: true; user: { id: string; iracingId: string; name: string } };

async function fetchViewer(): Promise<ViewerState> {
  try {
    const r = await fetch(`${AUTH_BASE}/api/viewer`, { method: "GET", credentials: "include" });
    const json = await r.json().catch(() => ({ verified: false }));
    if (json?.verified && json?.user) return { loading: false, verified: true, user: json.user };
    return { loading: false, verified: false };
  } catch {
    return { loading: false, verified: false };
  }
}

function Topbar() {
  const [viewer, setViewer] = useState<ViewerState>({ loading: true, verified: false });
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    (async () => setViewer(await fetchViewer()))();
  }, []);

  // Close menu on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname, location.search]);

  // Close on Escape
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Close when clicking outside the mobile menu (but ignore hamburger clicks)
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!mobileOpen) return;

      const target = e.target as HTMLElement | null;

      // If the click is on the hamburger button (or inside it), ignore it
      if (target?.closest?.(".hamburger")) return;

      const el = menuRef.current;
      if (!el) return;

      // If click is outside the menu panel, close it
      if (e.target instanceof Node && !el.contains(e.target)) setMobileOpen(false);
    }

    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [mobileOpen]);

  async function logout() {
    try {
      await fetch(`${AUTH_BASE}/api/auth/logout`, { method: "POST", credentials: "include" });
    } finally {
      setViewer(await fetchViewer());
      window.location.reload();
    }
  }

  const verifyHref = `${AUTH_BASE}/api/auth/start?returnTo=${encodeURIComponent(location.pathname + location.search)}`;
  const statusText = viewer.loading ? "Checking…" : viewer.verified ? "Verified" : "Browse mode";

  return (
    <header className="topbar">
      <div className="container topbar-inner">
        <div className="brand">
          <Link to="/" className="brand-link" aria-label="GridRep home">
            GridRep
          </Link>
          <small className="brand-tagline">Props (GGs) for clean racing</small>
        </div>

        {/* Desktop nav (hidden on small screens via CSS) */}
        <nav className="nav nav-desktop" aria-label="Primary navigation">
          <Link to="/leaderboard">Leaderboard</Link>
          <Link to="/about">About</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/pace">Pace</Link>

          <span className="badge" style={{ marginLeft: 10 }}>
            <span className="badge-dot" />
            {statusText}
          </span>

          {viewer.verified ? (
            <button className="btn btn-ghost" type="button" onClick={logout}>
              Logout
            </button>
          ) : (
            <a className="btn btn-ghost" href={verifyHref} style={{ textDecoration: "none" }} title="Verify with iRacing">
              Verify
            </a>
          )}
        </nav>

        {/* Mobile actions: status + hamburger */}
        <div className="nav-mobile-actions">
          <span className="badge">
            <span className="badge-dot" />
            {statusText}
          </span>

          <button
            className={`btn btn-ghost hamburger ${mobileOpen ? "open" : ""}`}
            type="button"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            aria-controls="mobile-menu"
            onClick={() => setMobileOpen((v) => !v)}
          >
            <span className="hamburger-icon" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
          </button>
        </div>
      </div>

      {/* Mobile menu panel */}
      <div
        id="mobile-menu"
        ref={menuRef}
        className={`mobile-menu ${mobileOpen ? "open" : ""}`}
        role="dialog"
        aria-label="Mobile navigation"
      >
        <div className="mobile-menu-inner container">
          <Link to="/leaderboard" className="mobile-link">
            Leaderboard
          </Link>
          <Link to="/about" className="mobile-link">
            About
          </Link>
          <Link to="/privacy" className="mobile-link">
            Privacy
          </Link>
          <Link to="/pace" className="mobile-link">
            Pace
          </Link>

          <div className="mobile-divider" />

          {viewer.verified ? (
            <button className="btn btn-ghost mobile-action" type="button" onClick={logout}>
              Logout
            </button>
          ) : (
            <a className="btn btn-ghost mobile-action" href={verifyHref} style={{ textDecoration: "none" }}>
              Verify with iRacing →
            </a>
          )}
        </div>
      </div>
    </header>
  );
}

function PaceApp() {
  return (
    <Routes>
      <Route
        path="/pace"
        element={
          <PaceLayout>
            <PaceHome />
          </PaceLayout>
        }
      />
      <Route
        path="/pace/s/:subsessionId"
        element={
          <PaceLayout>
            <PaceSubsession />
          </PaceLayout>
        }
      />
    </Routes>
  );
}

function RacePlannerApp() {
  return (
    <PlanContextProvider>
    <Routes>
      <Route
        path="/race-planner"
        element={
          <RacePlannerLayout>
            <HomePage />
          </RacePlannerLayout>
        }
      />
      <Route
        path="/race-planner/series"
        element={
          <RacePlannerLayout>
            <EventsHome />
          </RacePlannerLayout>
        }
      />
      <Route
        path="/race-planner/welcome"
        element={
          <RacePlannerLayout skipOnboardingGate>
            <WelcomePage />
          </RacePlannerLayout>
        }
      />
      <Route
        path="/race-planner/profile"
        element={
          <RacePlannerLayout>
            <DriverProfilePage />
          </RacePlannerLayout>
        }
      />
      <Route
        path="/race-planner/team"
        element={
          <RacePlannerLayout>
            <TeamListPage />
          </RacePlannerLayout>
        }
      />
      <Route
        path="/race-planner/team/:teamId"
        element={
          <RacePlannerLayout>
            <TeamPage />
          </RacePlannerLayout>
        }
      />
      <Route
        path="/race-planner/join/:token"
        element={
          <RacePlannerLayout skipOnboardingGate>
            <JoinTeamPage />
          </RacePlannerLayout>
        }
      />
      <Route
        path="/race-planner/series/:seriesId"
        element={
          <RacePlannerLayout>
            <SeriesSessionsPage />
          </RacePlannerLayout>
        }
      />
      <Route
        path="/race-planner/conditions"
        element={
          <RacePlannerLayout>
            <PlaceholderPage title="Conditions" note="Select an event first — its conditions page lives at /race-planner/conditions/:eventId." />
          </RacePlannerLayout>
        }
      />
      <Route
        path="/race-planner/conditions/:eventId"
        element={
          <RacePlannerLayout>
            <ConditionsPage />
          </RacePlannerLayout>
        }
      />
      <Route
        path="/race-planner/lineup"
        element={
          <RacePlannerLayout>
            <PlaceholderPage title="Driver lineup" note="Select a session first — its lineup page lives at /race-planner/lineup/:planId." />
          </RacePlannerLayout>
        }
      />
      <Route
        path="/race-planner/lineup/:planId"
        element={
          <RacePlannerLayout>
            <LineupPage />
          </RacePlannerLayout>
        }
      />
      <Route
        path="/race-planner/availability"
        element={
          <RacePlannerLayout>
            <PlaceholderPage title="Availability & scheduling" note="Select a session first — its availability page lives at /race-planner/availability/:planId." />
          </RacePlannerLayout>
        }
      />
      <Route
        path="/race-planner/availability/:planId"
        element={
          <RacePlannerLayout>
            <AvailabilityPage />
          </RacePlannerLayout>
        }
      />
      <Route
        path="/race-planner/stints"
        element={
          <RacePlannerLayout>
            <PlaceholderPage title="Stint plan" note="Select a session first — its stint plan lives at /race-planner/stints/:planId." />
          </RacePlannerLayout>
        }
      />
      <Route
        path="/race-planner/stints/:planId"
        element={
          <RacePlannerLayout>
            <StintsPage />
          </RacePlannerLayout>
        }
      />
      <Route
        path="/race-planner/plan"
        element={
          <RacePlannerLayout>
            <PlaceholderPage title="Plan summary" note="Select a session first — its plan summary lives at /race-planner/plan/:planId." />
          </RacePlannerLayout>
        }
      />
      <Route
        path="/race-planner/plan/:planId"
        element={
          <RacePlannerLayout>
            <PlanSummaryPage />
          </RacePlannerLayout>
        }
      />
      <Route
        path="/race-planner/live"
        element={
          <RacePlannerLayout>
            <PlaceholderPage title="Live" note="Select a session first — its live tracking page lives at /race-planner/live/:planId." />
          </RacePlannerLayout>
        }
      />
      <Route
        path="/race-planner/live/:planId"
        element={
          <RacePlannerLayout>
            <LivePage />
          </RacePlannerLayout>
        }
      />
    </Routes>
    </PlanContextProvider>
  );
}

export default function App() {
  const location = useLocation();

  if (location.pathname === "/pace" || location.pathname.startsWith("/pace/")) {
    return <PaceApp />;
  }

  if (location.pathname === "/race-planner" || location.pathname.startsWith("/race-planner/")) {
    return <RacePlannerApp />;
  }

  return (
    <div className="shell bg-grid">
      <Topbar />

      <main className="container" style={{ paddingTop: 18, paddingBottom: 40 }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/d/:driverId" element={<Driver />} />
          <Route path="/s/:sessionId" element={<Session />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/about" element={<About />} />
          <Route path="/privacy" element={<Privacy />} />
        </Routes>
      </main>
    </div>
  );
}