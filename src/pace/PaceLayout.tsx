import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { usePaceViewer } from "./usePaceViewer";
import "./pace.css";

export default function PaceLayout({ children }: { children: ReactNode }) {
  const viewer = usePaceViewer();
  const location = useLocation();

  const verifyHref = `/api/auth/start?returnTo=${encodeURIComponent(location.pathname + location.search)}`;
  const statusText = viewer.loading ? "Checking…" : viewer.verified ? viewer.user.name : "Not signed in";

  return (
    <div className="pace-shell">
      <header className="pace-header">
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Link to="/pace" className="pace-brand">
            Pace
          </Link>
          <a href="/" className="pace-back">
            ← GridRep
          </a>
        </div>

        <div className="pace-status">
          {viewer.verified ? statusText : <a href={verifyHref}>Sign in with iRacing</a>}
        </div>
      </header>

      <main className="pace-main">{children}</main>
    </div>
  );
}
