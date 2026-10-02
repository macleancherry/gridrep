import type { CommandHandler } from "./types.ts";

// Paused (PRD: iRacing's 30 Sept 2026 notice + EULA 6.3 on commercial-style
// redistribution) - this posted real names+custids for an entire series' standings
// (every entrant, not just gridrep's own team), straight from iRacing's Data API via
// this bot's service account, with no consent check. Gating it by consent would just
// produce a leaderboard of identical placeholder names (nobody in an arbitrary public
// series has consented through gridrep), so unlike a single-driver lookup this isn't
// fixed by anonymising - it needs a product decision on whether the feature continues
// in some other form. See the Gridrep Identity Compliance: Phase 2 PRD's open question
// on this bot's arbitrary-lookup commands.
export const championshipCommand: CommandHandler = async () => ({
  content:
    "Series-wide championship standings are temporarily unavailable while we review how this bot handles driver names that aren't gridrep's own team's.",
});
