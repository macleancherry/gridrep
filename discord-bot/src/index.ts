import { verifyDiscordRequest } from "./discord/verify.ts";
import { pong, deferred, errorReply } from "./discord/respond.ts";
import { editOriginalInteractionResponse } from "./lib/discordApi.ts";
import { commandHandlers, ADMIN_ONLY_COMMANDS } from "./commands/index.ts";
import { isGuildAdmin, requesterId, type Interaction } from "./discord/types.ts";
import { ensureGuild } from "./lib/db.ts";
import { pollAndAnnounce, type AnnouncementEnv } from "./announcements/poll.ts";
import type { BotEnv } from "./lib/iracingAuth.ts";

export type Env = BotEnv &
  AnnouncementEnv & {
    DISCORD_PUBLIC_KEY: string;
    DISCORD_APPLICATION_ID: string;
  };

const InteractionType = { PING: 1, APPLICATION_COMMAND: 2 } as const;

async function runCommand(interaction: Interaction, env: Env): Promise<void> {
  const name = interaction.data!.name;
  const handler = commandHandlers[name];

  try {
    if (!handler) {
      await editOriginalInteractionResponse(env.DISCORD_APPLICATION_ID, interaction.token, { content: `Unknown command: /${name}` });
      return;
    }

    if (ADMIN_ONLY_COMMANDS.has(name) && interaction.guild_id) {
      const guild = await ensureGuild(env.DB, interaction.guild_id);
      if (!isGuildAdmin(interaction, guild.admin_role_id)) {
        await editOriginalInteractionResponse(env.DISCORD_APPLICATION_ID, interaction.token, {
          content: "You need the configured admin role to use this command. See `/setup admin_role`.",
        });
        return;
      }
    }

    const result = await handler(interaction, env);
    await editOriginalInteractionResponse(env.DISCORD_APPLICATION_ID, interaction.token, result);
  } catch (err) {
    console.error(`Command /${name} failed`, { err, userId: requesterId(interaction) });
    await editOriginalInteractionResponse(env.DISCORD_APPLICATION_ID, interaction.token, {
      content: "Something went wrong running that command. Please try again shortly.",
    });
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("gridrep-discord-bot: expects Discord interaction POSTs", { status: 200 });
    }

    const { valid, body } = await verifyDiscordRequest(request, env.DISCORD_PUBLIC_KEY);
    if (!valid) {
      return new Response("Invalid request signature", { status: 401 });
    }

    const interaction = JSON.parse(body) as Interaction;

    if (interaction.type === InteractionType.PING) {
      return pong();
    }

    if (interaction.type === InteractionType.APPLICATION_COMMAND) {
      if (!interaction.data) return errorReply("Malformed interaction.");
      ctx.waitUntil(runCommand(interaction, env));
      return deferred();
    }

    return new Response("Unsupported interaction type", { status: 400 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(pollAndAnnounce(env));
  },
};
