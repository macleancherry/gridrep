const API_BASE = "https://discord.com/api/v10";

export type DiscordEmbed = {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  image?: { url: string };
  footer?: { text: string };
  timestamp?: string;
};

async function discordFetch(botToken: string, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord API error ${res.status} on ${path}: ${text}`);
  }
  return res;
}

export async function postChannelMessage(
  botToken: string,
  channelId: string,
  payload: { content?: string; embeds?: DiscordEmbed[] }
): Promise<void> {
  await discordFetch(botToken, `/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function editOriginalInteractionResponse(
  applicationId: string,
  interactionToken: string,
  payload: { content?: string; embeds?: DiscordEmbed[] }
): Promise<void> {
  const res = await fetch(`${API_BASE}/webhooks/${applicationId}/${interactionToken}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord followup edit error ${res.status}: ${text}`);
  }
}
