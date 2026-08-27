import type { Interaction } from "../discord/types.ts";
import type { BotEnv } from "../lib/iracingAuth.ts";
import type { DiscordEmbed } from "../lib/discordApi.ts";

export type CommandResult = { content?: string; embeds?: DiscordEmbed[] };
export type CommandHandler = (interaction: Interaction, env: BotEnv) => Promise<CommandResult>;
