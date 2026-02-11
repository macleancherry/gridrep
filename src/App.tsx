import { Routes, Route, Link } from "react-router-dom";
import Home from "./pages/Home";
import Driver from "./pages/Driver";
import Session from "./pages/Session";
import Leaderboard from "./pages/Leaderboard";

export default function App() {
  return (
    <div style={{ fontFamily: "system-ui" }}>
      <header style={{ padding: 16, borderBottom: "1px solid #eee" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
          <Link to="/" style={{ textDecoration: "none", color: "inherit" }}>
            <strong>GridRep</strong>
          </Link>
          <span style={{ color: "#666" }}>Props (GGs) for clean racing</span>
          <div style={{ marginLeft: "auto" }}>
            <Link to="/leaderboard">Leaderboard</Link>
          </div>
        </div>
      </header>

      <main style={{ padding: 16, maxWidth: 980, margin: "0 auto" }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/d/:driverId" element={<Driver />} />
          <Route path="/s/:sessionId" element={<Session />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
        </Routes>
      </main>
    </div>
  );
}
