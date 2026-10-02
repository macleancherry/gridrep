// Gates every driver name this bot would otherwise post/display against the same
// consent system the main app uses (iRacing's 30 Sept 2026 third-party notice: a
// member's display name/custid can't be shown without their explicit consent).
//
// This bot is a separate Cloudflare Worker, but it shares the exact same D1 database
// as the main app (see wrangler.toml / discord-bot/wrangler.toml - identical
// database_id), so it can resolve/check identity through the same single chokepoint
// (functions/_lib/driverIdentity.ts) rather than building a parallel consent system.
// Nothing here writes a raw name anywhere this bot's own tables didn't already - it
// only decides what's safe to put in front of a Discord server.
import { resolveDriverId, displayDriver } from "../../../functions/_lib/driverIdentity.ts";

export const ANONYMOUS_DRIVER_LABEL = "An iRacing driver";

/**
 * Resolves a custid to its opaque driverId, seeding driver_identities with
 * whatever name the bot's own iRacing lookup just returned (storage only -
 * see driverIdentity.ts; this does not make the name visible to anyone).
 */
export async function identifyDriver(DB: D1Database, custId: string, name: string | null): Promise<string> {
  return resolveDriverId(DB, custId, name);
}

/**
 * The one function allowed to decide what name (if any) this bot shows for a
 * custid. Returns the real name only with active consent; otherwise null -
 * callers decide whether that means "skip this" (announcements, where an
 * anonymised post has no value) or "show a generic label" (a lookup command that
 * still owes the user *some* answer). Never the raw name, never the custid.
 */
export async function gatedDriverName(DB: D1Database, custId: string, fallbackName: string | null): Promise<string | null> {
  const driverId = await identifyDriver(DB, custId, fallbackName);
  const display = await displayDriver(DB, driverId);
  return display.name;
}

/** Convenience wrapper for a lookup command that must show *something* rather
 * than silently doing nothing. */
export async function gatedDriverNameOrLabel(DB: D1Database, custId: string, fallbackName: string | null): Promise<string> {
  return (await gatedDriverName(DB, custId, fallbackName)) ?? ANONYMOUS_DRIVER_LABEL;
}

/**
 * Drop-in replacement for a list of this bot's own TrackedDriver-shaped rows
 * (guild_id, cust_id, display_name, ...) - returns a same-shaped copy with
 * display_name gated by consent (null if not consented), using each row's own
 * cached name only to seed driver_identities the first time a custid is seen.
 * Every /team, /points, /week, /iRatingChanges, /championship, /laps-style
 * command that reads bot_tracked_drivers should wrap it in this before
 * building any Discord-facing output.
 */
export async function gateTrackedDrivers<T extends { cust_id: number; display_name: string | null }>(DB: D1Database, drivers: T[]): Promise<T[]> {
  const gated = await Promise.all(
    drivers.map(async (d) => ({ ...d, display_name: await gatedDriverName(DB, String(d.cust_id), d.display_name) }))
  );
  return gated;
}
