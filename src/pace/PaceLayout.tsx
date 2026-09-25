import type { CSSProperties, ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { usePaceViewer } from "./usePaceViewer";
import { usePaceBrand, withBrand } from "./brands";
import "./pace.css";

export default function PaceLayout({ children }: { children: ReactNode }) {
  const viewer = usePaceViewer();
  const location = useLocation();
  const { brand, brandKey } = usePaceBrand();

  const verifyHref = `/api/auth/start?returnTo=${encodeURIComponent(location.pathname + location.search)}`;
  const statusText = viewer.loading ? "Checking…" : viewer.verified ? viewer.user.name : "Not signed in";

  // Recolors links (the shell's one accent use) to the partner's own brand
  // color rather than restyling the page - keeps this a genuine Pace page
  // wearing their color, not a redesign pretending to be their site.
  const shellStyle = brand ? ({ "--pace-accent": brand.accent } as CSSProperties) : undefined;

  return (
    <div className="pace-shell" style={shellStyle}>
      <header className="pace-header">
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {brand ? (
            <a href={brand.homeUrl} className="pace-brand">
              {brand.name}
            </a>
          ) : (
            <Link to="/pace" className="pace-brand">
              Pace
            </Link>
          )}
          <Link to={withBrand("/pace", brandKey)} className="pace-back">
            ← New search
          </Link>
          {brand && <span className="pace-hint" style={{ margin: 0, fontSize: "0.75rem" }}>Pace by GridRep</span>}
        </div>

        <div className="pace-status">
          {viewer.verified ? statusText : <a href={verifyHref}>Sign in with iRacing</a>}
        </div>
      </header>

      <main className="pace-main">{children}</main>
    </div>
  );
}
