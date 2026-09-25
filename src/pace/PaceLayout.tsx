import { useEffect, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { usePaceViewer } from "./usePaceViewer";
import { usePaceBrand, withBrand } from "./brands";
import "./pace.css";

/** Loads a brand's Google Font stylesheet on demand rather than bundling
 * every partner's font for every visitor - swaps it out if the brand
 * changes, and removes it entirely once unbranded. */
function useBrandFont(href: string | undefined) {
  useEffect(() => {
    if (!href) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, [href]);
}

export default function PaceLayout({ children }: { children: ReactNode }) {
  const viewer = usePaceViewer();
  const location = useLocation();
  const { brand, brandKey } = usePaceBrand();

  useBrandFont(brand?.googleFontHref);

  const verifyHref = `/api/auth/start?returnTo=${encodeURIComponent(location.pathname + location.search)}`;
  const statusText = viewer.loading ? "Checking…" : viewer.verified ? viewer.user.name : "Not signed in";

  // Every brand var maps straight onto pace.css's --pace-* custom properties,
  // each with a neutral default that reproduces today's plain look - so this
  // is a themed skin of the same page, not a redesign or a fork of it.
  const shellStyle = brand ? (brand.vars as CSSProperties) : undefined;

  return (
    <div className="pace-shell" style={shellStyle}>
      <header className="pace-header">
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {brand ? (
            <a href={brand.homeUrl} className="pace-brand">
              {brand.logoUrl ? <img src={brand.logoUrl} alt={brand.name} className="pace-brand-logo" /> : brand.name}
            </a>
          ) : (
            <Link to="/pace" className="pace-brand">
              Pace
            </Link>
          )}
          <Link to={withBrand("/pace", brandKey)} className="pace-back">
            ← New search
          </Link>
          {brand && (
            <span className="pace-hint" style={{ margin: 0, fontSize: "0.75rem" }}>
              Pace by GridRep
            </span>
          )}
        </div>

        {/* Sign-in is an admin affordance (following/syncing leagues,
            pulling a subsession) - a branded view has none of those
            controls, so there's nothing for a public visitor to sign in
            for. Hidden there rather than shown with no purpose. */}
        {!brand && (
          <div className="pace-status">
            {viewer.verified ? statusText : <a href={verifyHref}>Sign in with iRacing</a>}
          </div>
        )}
      </header>

      <main className="pace-main">{children}</main>
    </div>
  );
}
