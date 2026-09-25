import { useEffect, useState } from "react";

const STORAGE_KEY = "pace:myDriverName";

/**
 * A visitor's own driver name, remembered per-browser (no account/login
 * needed - Pace's results pages are public) so their row can be
 * highlighted on every race they look at, not just this one. Read once on
 * mount rather than via a live storage listener - this only ever changes
 * from the input this hook itself renders, in this same tab.
 */
export function useMyDriverName(): [string, (name: string) => void] {
  const [name, setNameState] = useState("");

  useEffect(() => {
    try {
      setNameState(localStorage.getItem(STORAGE_KEY) ?? "");
    } catch {
      // Private-browsing/blocked storage - just fall back to no saved name.
    }
  }, []);

  function setName(next: string) {
    setNameState(next);
    try {
      if (next.trim()) localStorage.setItem(STORAGE_KEY, next);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Nothing to do if storage is unavailable - the in-memory value above
      // still highlights for the rest of this visit.
    }
  }

  return [name, setName];
}
