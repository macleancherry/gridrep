import { useEffect, useState } from "react";

export type ViewerState =
  | { loading: true; verified: false }
  | { loading: false; verified: false }
  | { loading: false; verified: true; user: { id: string; iracingId: string; name: string } };

async function fetchViewer(): Promise<ViewerState> {
  try {
    const r = await fetch("/api/viewer", { method: "GET", credentials: "include" });
    const data = await r.json().catch(() => ({ verified: false }));
    if (data?.verified && data?.user) return { loading: false, verified: true, user: data.user };
    return { loading: false, verified: false };
  } catch {
    return { loading: false, verified: false };
  }
}

export function usePaceViewer(): ViewerState {
  const [viewer, setViewer] = useState<ViewerState>({ loading: true, verified: false });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const result = await fetchViewer();
      if (!cancelled) setViewer(result);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return viewer;
}
