import { useEffect, useMemo, useState } from "react";

export type DriverSearchResult = { id: string; name: string };

/**
 * Merges gridrep's local drivers table (only knows drivers who've already appeared in a
 * synced session) with a live iRacing name search (functions/api/planner/drivers/search.ts)
 * - closes the "can't add a driver we've never seen before" gap. Local matches come first
 * since they're already known to gridrep; live-only matches are appended, deduped by id.
 * gridrep's own drivers table answers near-instantly; the live iRacing lookup is a real
 * network round-trip and can take noticeably longer, so each fetch updates its own state
 * independently - whichever finishes first (almost always local) paints immediately and
 * nothing is blocked on the slower call.
 *
 * Extracted from LineupPage.tsx (the original call site) so the Team roster "add a driver"
 * flow can reuse the exact same progressive-loading behavior instead of re-implementing it.
 */
export function useDriverSearch(query: string) {
  const [localResults, setLocalResults] = useState<DriverSearchResult[]>([]);
  const [liveResults, setLiveResults] = useState<DriverSearchResult[]>([]);
  const [livePending, setLivePending] = useState(false);

  useEffect(() => {
    if (!query.trim()) {
      setLocalResults([]);
      setLiveResults([]);
      setLivePending(false);
      return;
    }
    let cancelled = false;
    const q = query.trim();
    setLiveResults([]); // clear any previous query's live matches right away
    setLivePending(true);

    const handle = setTimeout(() => {
      fetch(`/api/drivers/search?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((data) => {
          if (!cancelled) setLocalResults(data.results ?? []);
        })
        .catch(() => {
          if (!cancelled) setLocalResults([]);
        });

      fetch(`/api/planner/drivers/search?q=${encodeURIComponent(q)}`, { credentials: "include" })
        .then((r) => r.json())
        .then((data) => {
          if (!cancelled) setLiveResults(data.results ?? []);
        })
        .catch(() => {
          if (!cancelled) setLiveResults([]);
        })
        .finally(() => {
          if (!cancelled) setLivePending(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  const results = useMemo(() => {
    const seen = new Set(localResults.map((d) => d.id));
    return [...localResults, ...liveResults.filter((d) => !seen.has(d.id))];
  }, [localResults, liveResults]);

  return { results, livePending };
}
