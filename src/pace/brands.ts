import { useLocation } from "react-router-dom";

export type PaceBrand = {
  name: string;
  homeUrl: string;
  accent: string;
};

// Partner leagues that want Pace shown under their own identity - add an
// entry here and link them to ?brand=<key> (case-insensitive). Colors are
// pulled from the partner's own live site (theme primary/CTA colors), not
// guessed, so the branded page reads as genuinely theirs rather than a
// GridRep page with a different name pasted on top.
const PACE_BRANDS: Record<string, PaceBrand> = {
  AES: {
    name: "Aussie Endurance Series",
    homeUrl: "https://aesleague.org/",
    accent: "#e10000",
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
