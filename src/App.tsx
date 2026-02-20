import { useEffect, useRef, useState } from "react";
import { Routes, Route, Link, useLocation } from "react-router-dom";
import Home from "./pages/Home";
import Driver from "./pages/Driver";
import Session from "./pages/Session";
import Leaderboard from "./pages/Leaderboard";
import About from "./pages/About";
import Privacy from "./pages/Privacy";

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

export default function App() {
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