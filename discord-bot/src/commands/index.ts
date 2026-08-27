import type { CommandHandler } from "./types.ts";
import { driverCommand } from "./driver.ts";
import { previousRaceCommand, previousRacesCommand } from "./previousRace.ts";
import { lapsCommand } from "./laps.ts";
import { balanceCommand } from "./balance.ts";
import { championshipCommand } from "./championship.ts";
import { officialsCommand } from "./officials.ts";
import { participationCommand } from "./participation.ts";
import { popularityCommand } from "./popularity.ts";
import { scheduleCommand } from "./schedule.ts";
import { strengthOfFieldCommand } from "./strengthOfField.ts";
import { awardsCommand } from "./awards.ts";
import { convertCommand } from "./convert.ts";
import { manageTeamCommand } from "./manageTeam.ts";
import { teamCommand } from "./team.ts";
import { iratingChangesCommand } from "./iratingChanges.ts";
import { pointsCommand } from "./points.ts";
import { weekCommand } from "./week.ts";
import { leagueCommand } from "./league.ts";
import { setupCommand } from "./setup.ts";

export const commandHandlers: Record<string, CommandHandler> = {
  driver: driverCommand,
  previous_race: previousRaceCommand,
  previous_races: previousRacesCommand,
  laps: lapsCommand,
  balance: balanceCommand,
  championship: championshipCommand,
  officials: officialsCommand,
  participation: participationCommand,
  popularity: popularityCommand,
  schedule: scheduleCommand,
  strengthoffield: strengthOfFieldCommand,
  awards: awardsCommand,
  convert: convertCommand,
  manage_team: manageTeamCommand,
  team: teamCommand,
  irating_changes: iratingChangesCommand,
  points: pointsCommand,
  week: weekCommand,
  league: leagueCommand,
  setup: setupCommand,
};

// Commands that change server configuration or team rosters - gated behind
// the guild's configured admin role (see /setup admin_role), matching the
// original bot's admin-only command set. Everything else is open to any
// member (no subscription tier gating - this fork unlocks all commands).
export const ADMIN_ONLY_COMMANDS = new Set(["manage_team", "setup"]);
