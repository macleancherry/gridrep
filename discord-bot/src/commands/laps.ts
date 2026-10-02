import type { CommandHandler } from "./types.ts";

// Paused - same reason as championship.ts (full-series standings, real names/custids
// for arbitrary non-consented entrants, no value once anonymised). See that file's
// comment and the Gridrep Identity Compliance: Phase 2 PRD.
export const lapsCommand: CommandHandler = async () => ({
  content:
    "Series-wide pace standings are temporarily unavailable while we review how this bot handles driver names that aren't gridrep's own team's.",
});
