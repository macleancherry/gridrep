import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useRestartViewer } from "./useRestartViewer";
import "./restart.css";

export default function RestartLayout({ children }: { children: ReactNode }) {
  const viewer = useRestartViewer();
  const location = useLocation();

  const verifyHref = `/api/auth/start?returnTo=${encodeURIComponent(location.pathname + location.search)}`;
  const statusText = viewer.loading ? "Checking…" : viewer.verified ? viewer.user.name : "Not signed in";

  return (
    <div className="restart-shell">
      <header className="restart-header">
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Link to="/restart" className="restart-brand">
            Restart
          </Link>
          <a href="/" className="restart-back">
            ← GridRep
          </a>
        </div>

        <div className="restart-status">
          {viewer.verified ? statusText : <a href={verifyHref}>Sign in with iRacing</a>}
        </div>
      </header>

      <main className="restart-main">{children}</main>
    </div>
  );
}
