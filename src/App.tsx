import { useEffect, useState } from "react";
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
    if (json?.verified && json?.user) {
      return { loading: false, verified: true, user: json.user };
    }
    return { loading: false, verified: false };
  } catch {
    return { loading: false, verified: false };
  }
}

function Topbar() {
  const [viewer, setViewer] = useState<ViewerState>({ loading: true, verified: false });
  const location = useLocation();

  useEffect(() => {
    (async () => setViewer(await fetchViewer()))();
  }, []);

  async function logout() {
    try {
      await fetch(`${AUTH_BASE}/api/auth/logout`, { method: "POST", credentials: "include" });
    } finally {
      setViewer(await fetchViewer());
      window.location.reload();
    }
  }

  return (
    <header className="topbar">
      <div className="container topbar-inner">
        <div className="brand">
          <Link to="/">GridRep</Link>
          <small>Props (GGs) for clean racing</small>
        </div>

        <nav className="nav row" style={{ gap: 14, alignItems: "center" }}>
          <Link to="/leaderboard">Leaderboard</Link>
          <Link to="/about">About</Link>
          <Link to="/privacy">Privacy</Link>

          <span className="badge" style={{ marginLeft: 10 }}>
            <span className="badge-dot" />
            {viewer.loading ? "Checking…" : viewer.verified ? "Verified" : "Browse mode"}
          </span>

          {viewer.verified ? (
            <button className="btn btn-ghost" type="button" onClick={logout}>
              Logout
            </button>
          ) : (
            <a
              className="btn btn-ghost"
              href={`${AUTH_BASE}/api/auth/start?returnTo=${encodeURIComponent(location.pathname)}`}
              style={{ textDecoration: "none" }}
              title="Verify with iRacing"
            >
              Verify
            </a>
          )}
        </nav>
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
