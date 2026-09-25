import { useLocation } from "react-router-dom";

export type PaceBrand = {
  name: string;
  homeUrl: string;
  logoUrl?: string;
  googleFontHref?: string;
  /** When set, Pace's home page shows this league's synced races to pick
   * from instead of the raw subsession-pull / league-management tools -
   * meant for a single-league partner's own audience, not an admin. */
  leagueId?: string;
  /** Every value here maps straight onto a `--pace-*` custom property on
   * .pace-shell (see pace.css) - each one already has a light/neutral
   * default that reproduces today's plain Pace look, so a brand only needs
   * to set the ones it actually wants to change. This is what makes a
   * brand a themed *skin* of the same page rather than a fork of it. */
  vars: Partial<{
    "--pace-sans": string;
    "--pace-header-bg": string;
    "--pace-header-text": string;
    "--pace-header-muted": string;
    "--pace-accent": string;
    "--pace-panel-bg": string;
    "--pace-panel-padding": string;
    "--pace-heading": string;
    "--pace-heading-weight": string;
    "--pace-heading-transform": string;
    "--pace-heading-tracking": string;
    "--pace-table-header-bg": string;
    "--pace-table-header-text": string;
    "--pace-row-alt": string;
    "--pace-btn-bg": string;
    "--pace-btn-text": string;
    "--pace-btn-radius": string;
    "--pace-btn-weight": string;
    "--pace-btn-transform": string;
    "--pace-btn-tracking": string;
    "--pace-badge-bg": string;
    "--pace-badge-text": string;
    "--pace-highlight-bg": string;
    "--pace-highlight-border": string;
  }>;
};

// Partner leagues that want Pace shown under their own identity - add an
// entry here and link them to ?brand=<key> (case-insensitive). Every color,
// font and logo below is pulled from the partner's own live site (theme
// vars, CTA colors, uploaded logo file - see PR history for how AES's were
// found), never guessed, so the branded page reads as genuinely theirs
// rather than a GridRep page with a different name pasted on top.
const PACE_BRANDS: Record<string, PaceBrand> = {
  AES: {
    name: "Aussie Endurance Series",
    homeUrl: "https://aesleague.org/",
    logoUrl: "/brand/aes-logo.png",
    leagueId: "11090",
    googleFontHref: "https://fonts.googleapis.com/css2?family=DM+Sans:wght@500;700;800;900&display=swap",
    vars: {
      "--pace-sans": "'DM Sans', ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
      "--pace-header-bg": "#00021b",
      "--pace-header-text": "#ffffff",
      "--pace-header-muted": "rgba(255, 255, 255, 0.75)",
      "--pace-accent": "#e10000",
      "--pace-panel-bg": "#ececec",
      "--pace-panel-padding": "8px 14px",
      "--pace-heading": "#00021b",
      "--pace-heading-weight": "800",
      "--pace-heading-transform": "uppercase",
      "--pace-heading-tracking": "0.03em",
      "--pace-table-header-bg": "#00021b",
      "--pace-table-header-text": "#ffffff",
      "--pace-row-alt": "#f7f7f7",
      "--pace-btn-bg": "#e10000",
      "--pace-btn-text": "#ffffff",
      "--pace-btn-radius": "999px",
      "--pace-btn-weight": "700",
      "--pace-btn-transform": "uppercase",
      "--pace-btn-tracking": "0.03em",
      "--pace-badge-bg": "#00021b",
      "--pace-badge-text": "#ffffff",
      "--pace-highlight-bg": "rgba(225, 0, 0, 0.08)",
    },
  },
};

/** Appends the current brand param (if any) onto an internal Pace path, so a branded view stays branded across navigation. */
export function withBrand(path: string, brandKey: string | null): string {
  if (!brandKey) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}brand=${encodeURIComponent(brandKey)}`;
}

export function usePaceBrand(): { brand: PaceBrand | null; brandKey: string | null } {
  const location = useLocation();
  const brandKey = new URLSearchParams(location.search).get("brand");
  const brand = brandKey ? (PACE_BRANDS[brandKey.toUpperCase()] ?? null) : null;
  return { brand, brandKey: brand ? brandKey : null };
}
