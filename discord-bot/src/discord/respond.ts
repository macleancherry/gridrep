import type { DiscordEmbed } from "../lib/discordApi.ts";

export const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
} as const;

export function pong(): Response {
  return jsonResponse({ type: InteractionResponseType.PONG });
}

export function reply(content: string, opts: { embeds?: DiscordEmbed[]; ephemeral?: boolean } = {}): Response {
  return jsonResponse({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content,
      embeds: opts.embeds,
      flags: opts.ephemeral ? 1 << 6 : undefined,
    },
  });
}

export function replyEmbed(embed: DiscordEmbed, opts: { ephemeral?: boolean } = {}): Response {
  return jsonResponse({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { embeds: [embed], flags: opts.ephemeral ? 1 << 6 : undefined },
  });
}

export function deferred(opts: { ephemeral?: boolean } = {}): Response {
  return jsonResponse({
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: { flags: opts.ephemeral ? 1 << 6 : undefined },
  });
}

export function errorReply(message: string): Response {
  return reply(`⚠️ ${message}`, { ephemeral: true });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}
