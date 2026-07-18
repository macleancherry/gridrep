import { createContext, useContext, useState, type ReactNode } from "react";

/**
 * Tracks the "current" event/plan across the sidebar nav. Without this, the sidebar's
 * links (Lineup/Availability/Stints/Plan need a planId, Conditions needs an eventId)
 * have nothing to point at outside the specific page that's currently loaded - clicking
 * any of them landed on the bare, id-less route and dropped whatever you were working on.
 * Each page writes its own known ids in here once it loads them; the sidebar just reads.
 */
type PlanContextValue = {
  eventId: string | null;
  planId: string | null;
  setContext: (next: { eventId?: string | null; planId?: string | null }) => void;
};

const PlanContext = createContext<PlanContextValue | null>(null);

export function PlanContextProvider({ children }: { children: ReactNode }) {
  const [eventId, setEventId] = useState<string | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);

  function setContext(next: { eventId?: string | null; planId?: string | null }) {
    if (next.eventId !== undefined) setEventId(next.eventId);
    if (next.planId !== undefined) setPlanId(next.planId);
  }

  return <PlanContext.Provider value={{ eventId, planId, setContext }}>{children}</PlanContext.Provider>;
}

export function usePlanContext(): PlanContextValue {
  const ctx = useContext(PlanContext);
  if (!ctx) throw new Error("usePlanContext must be used within a PlanContextProvider");
  return ctx;
}
