import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useWhatIfViewer } from "./useWhatIfViewer";
import "./whatif.css";

export default function WhatIfLayout({ children }: { children: ReactNode }) {
  const viewer = useWhatIfViewer();
  const location = useLocation();

  const verifyHref = `/api/auth/start?returnTo=${encodeURIComponent(location.pathname + location.search)}`;
  const statusText = viewer.loading ? "Checking…" : viewer.verified ? viewer.user.name : "Not signed in";

  return (
    <div className="whatif-shell">
      <header className="whatif-header">
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Link to="/what-if" className="whatif-brand">
            What If
          </Link>
          <Link to="/what-if" className="whatif-back">
            ← New search
          </Link>
        </div>

        <div className="whatif-status">
          {viewer.verified ? statusText : <a href={verifyHref}>Sign in with iRacing</a>}
        </div>
      </header>

      <main className="whatif-main">{children}</main>
    </div>
  );
}
