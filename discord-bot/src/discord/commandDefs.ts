// Slash command schema tree, PUT to Discord by registerCommands.ts. Mirrors
// the command surface documented at
// https://iracingreports.com/discord-bot/commands/ - see the plan's
// "Researched feature/command inventory" for the source list. Unlike the
// original bot, nothing here is gated behind a subscription tier.

const OPT = {
  SUB_COMMAND: 1,
  STRING: 3,
  INTEGER: 4,
  BOOLEAN: 5,
  USER: 6,
  CHANNEL: 7,
  NUMBER: 10,
} as const;

const driverOption = { type: OPT.STRING, name: "driver", description: "Driver name or cust_id", required: true };
const seriesOption = { type: OPT.STRING, name: "series", description: "Series name or id", required: true };
const seasonOption = { type: OPT.STRING, name: "season", description: "Season (defaults to current)", required: false };

export const commandDefinitions = [
  { name: "driver", description: "Driver profile: iRating trend, incidents, license", options: [driverOption] },
  { name: "previous_race", description: "A driver's most recent race result", options: [driverOption] },
  { name: "previous_races", description: "A driver's last 10 race results", options: [driverOption] },
  {
    name: "laps",
    description: "Lap pace tables and charts",
    options: [
      { type: OPT.SUB_COMMAND, name: "qualifying", description: "Qualifying lap pace", options: [seriesOption, seasonOption] },
      { type: OPT.SUB_COMMAND, name: "race_average", description: "Average race lap pace", options: [seriesOption, seasonOption] },
      { type: OPT.SUB_COMMAND, name: "race_fastest", description: "Fastest race lap pace", options: [seriesOption, seasonOption] },
    ],
  },
  {
    name: "balance",
    description: "Compare car performance within a series",
    options: [
      seriesOption,
      { type: OPT.STRING, name: "division", description: "Filter by division", required: false },
      { type: OPT.STRING, name: "skill", description: "Filter by skill band", required: false },
    ],
  },
  { name: "championship", description: "Top-30 championship standings for a series", options: [seriesOption, seasonOption] },
  { name: "officials", description: "Heatmap of official session frequency", options: [seriesOption] },
  { name: "participation", description: "Heatmap of driver participation by time", options: [seriesOption] },
  {
    name: "popularity",
    description: "Series ranked by unique drivers",
    options: [{ type: OPT.STRING, name: "category", description: "Race category", required: false }],
  },
  { name: "schedule", description: "Track rotation for a series season", options: [seriesOption, seasonOption] },
  { name: "strengthoffield", description: "Heatmap of top-tier skill distribution", options: [seriesOption] },
  { name: "awards", description: "A driver's poles, overtakes, and other awards", options: [driverOption] },
  {
    name: "convert",
    description: "Unit conversion",
    options: [
      {
        type: OPT.SUB_COMMAND,
        name: "temperature",
        description: "Convert temperature",
        options: [
          { type: OPT.NUMBER, name: "value", description: "Value to convert", required: true },
          { type: OPT.STRING, name: "from", description: "c or f", required: true, choices: [{ name: "Celsius", value: "c" }, { name: "Fahrenheit", value: "f" }] },
        ],
      },
      {
        type: OPT.SUB_COMMAND,
        name: "volume",
        description: "Convert volume (liters/gallons)",
        options: [
          { type: OPT.NUMBER, name: "value", description: "Value to convert", required: true },
          { type: OPT.STRING, name: "from", description: "l or gal", required: true, choices: [{ name: "Liters", value: "l" }, { name: "Gallons", value: "gal" }] },
        ],
      },
      {
        type: OPT.SUB_COMMAND,
        name: "speed",
        description: "Convert speed (kph/mph)",
        options: [
          { type: OPT.NUMBER, name: "value", description: "Value to convert", required: true },
          { type: OPT.STRING, name: "from", description: "kph or mph", required: true, choices: [{ name: "KPH", value: "kph" }, { name: "MPH", value: "mph" }] },
        ],
      },
    ],
  },
  {
    name: "manage_team",
    description: "Manage the tracked driver roster for this server",
    default_member_permissions: "0",
    options: [
      {
        type: OPT.SUB_COMMAND,
        name: "add",
        description: "Track a driver",
        options: [driverOption, { type: OPT.USER, name: "discord_user", description: "Linked Discord account", required: false }],
      },
      { type: OPT.SUB_COMMAND, name: "remove", description: "Stop tracking a driver", options: [driverOption] },
      {
        type: OPT.SUB_COMMAND,
        name: "update",
        description: "Update a tracked driver",
        options: [
          driverOption,
          { type: OPT.STRING, name: "highlight_color", description: "Hex color, e.g. #3b82f6", required: false },
          { type: OPT.USER, name: "discord_user", description: "Linked Discord account", required: false },
        ],
      },
      {
        type: OPT.SUB_COMMAND,
        name: "announcements_exclude",
        description: "Include/exclude a driver from race announcements",
        options: [driverOption, { type: OPT.BOOLEAN, name: "excluded", description: "Exclude from announcements", required: true }],
      },
    ],
  },
  {
    name: "team",
    description: "Team roster views",
    options: [
      { type: OPT.SUB_COMMAND, name: "colors", description: "Configured highlight colors" },
      { type: OPT.SUB_COMMAND, name: "discord_mappings", description: "Linked Discord accounts" },
      { type: OPT.SUB_COMMAND, name: "divisions", description: "Team members by skill division" },
      { type: OPT.SUB_COMMAND, name: "inactive", description: "Drivers without recent activity" },
      {
        type: OPT.SUB_COMMAND,
        name: "quick_stats",
        description: "Team performance snapshot",
        options: [{ type: OPT.STRING, name: "sort_by", description: "irating, incidents, or name", required: false }],
      },
    ],
  },
  { name: "irating_changes", description: "Weekly iRating changes for tracked team drivers" },
  { name: "points", description: "Championship point breakdown for tracked team drivers", options: [{ type: OPT.STRING, name: "series", description: "Series name or id", required: false }] },
  { name: "week", description: "Weekly race participation and points summary for tracked team drivers" },
  {
    name: "league",
    description: "League-scoped stats (requires /setup leagues)",
    options: [
      { type: OPT.SUB_COMMAND, name: "driver", description: "Driver stats within the league", options: [driverOption] },
      { type: OPT.SUB_COMMAND, name: "previous_race", description: "Most recent league race", options: [driverOption] },
      { type: OPT.SUB_COMMAND, name: "previous_races", description: "Last 10 league races", options: [driverOption] },
      { type: OPT.SUB_COMMAND, name: "championship", description: "League season standings" },
      {
        type: OPT.SUB_COMMAND,
        name: "compare",
        description: "Head-to-head league comparison",
        options: [
          { type: OPT.STRING, name: "driver_a", description: "First driver", required: true },
          { type: OPT.STRING, name: "driver_b", description: "Second driver", required: true },
        ],
      },
      { type: OPT.SUB_COMMAND, name: "track_stats", description: "Track-specific league performance", options: [{ type: OPT.STRING, name: "track", description: "Track name", required: true }] },
      { type: OPT.SUB_COMMAND, name: "info", description: "League metadata and overview" },
      { type: OPT.SUB_COMMAND, name: "seasons", description: "Set the default league season", options: [{ type: OPT.STRING, name: "season", description: "Season to set as default", required: true }] },
      { type: OPT.SUB_COMMAND, name: "awards", description: "League superlatives and honors" },
    ],
  },
  {
    name: "setup",
    description: "Configure the bot for this server",
    default_member_permissions: "0",
    options: [
      { type: OPT.SUB_COMMAND, name: "admin_role", description: "Role allowed to run admin commands", options: [{ type: 8, name: "role", description: "Admin role", required: true }] },
      { type: OPT.SUB_COMMAND, name: "results_announcer", description: "Default channel for race announcements", options: [{ type: OPT.CHANNEL, name: "channel", description: "Channel", required: true }] },
      { type: OPT.SUB_COMMAND, name: "force_channel", description: "Restrict bot commands to one channel", options: [{ type: OPT.CHANNEL, name: "channel", description: "Channel (omit to clear)", required: false }] },
      {
        type: OPT.SUB_COMMAND,
        name: "leagues",
        description: "Add or remove a tracked league",
        options: [
          { type: OPT.STRING, name: "action", description: "add or remove", required: true, choices: [{ name: "Add", value: "add" }, { name: "Remove", value: "remove" }] },
          { type: OPT.INTEGER, name: "league_id", description: "iRacing league id", required: true },
          { type: OPT.STRING, name: "name", description: "Display name", required: false },
        ],
      },
      { type: OPT.SUB_COMMAND, name: "hide_flags", description: "Toggle country flag display", options: [{ type: OPT.BOOLEAN, name: "enabled", description: "Hide flags", required: true }] },
      { type: OPT.SUB_COMMAND, name: "show_license_letter", description: "Toggle license tier indicators", options: [{ type: OPT.BOOLEAN, name: "enabled", description: "Show license letter", required: true }] },
      { type: OPT.SUB_COMMAND, name: "mention_race_announcements", description: "Toggle @mentioning linked users in announcements", options: [{ type: OPT.BOOLEAN, name: "enabled", description: "Mention users", required: true }] },
      { type: OPT.SUB_COMMAND, name: "view_series_channels", description: "Show series-to-channel mappings" },
      {
        type: OPT.SUB_COMMAND,
        name: "add_series_channel",
        description: "Route a series' announcements to a channel",
        options: [
          { type: OPT.INTEGER, name: "series_id", description: "iRacing series id", required: true },
          { type: OPT.CHANNEL, name: "channel", description: "Destination channel", required: true },
        ],
      },
      { type: OPT.SUB_COMMAND, name: "remove_series_channel", description: "Remove a series-to-channel mapping", options: [{ type: OPT.INTEGER, name: "series_id", description: "iRacing series id", required: true }] },
      { type: OPT.SUB_COMMAND, name: "default_results_channel", description: "Set the fallback announcement channel", options: [{ type: OPT.CHANNEL, name: "channel", description: "Channel", required: true }] },
    ],
  },
];
