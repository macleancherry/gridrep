import { Routes, Route, Link } from "react-router-dom";
import Home from "./pages/Home";
import Driver from "./pages/Driver";
import Session from "./pages/Session";
import Leaderboard from "./pages/Leaderboard";
import About from "./pages/About";
import Privacy from "./pages/Privacy";

export default function App() {
  return (
<div className="shell bg-grid">
      <header className="topbar">
        <div className="container topbar-inner">
          <div className="brand">
            <Link to="/">GridRep</Link>
            <small>Props (GGs) for clean racing</small>
          </div>

          <nav className="nav row" style={{ gap: 14 }}>
            <Link to="/leaderboard">Leaderboard</Link>
            <Link to="/about">About</Link>
            <Link to="/privacy">Privacy</Link>
          </nav>
        </div>
      </header>

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
