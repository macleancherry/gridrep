// One-time (or CI) script: PUT the full command tree to Discord.
// Run with: DISCORD_APPLICATION_ID=... DISCORD_BOT_TOKEN=... npm run register-commands
import { commandDefinitions } from "./commandDefs.ts";

const applicationId = process.env.DISCORD_APPLICATION_ID;
const botToken = process.env.DISCORD_BOT_TOKEN;

if (!applicationId || !botToken) {
  console.error("Set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN environment variables first.");
  process.exit(1);
}

const res = await fetch(`https://discord.com/api/v10/applications/${applicationId}/commands`, {
  method: "PUT",
  headers: {
    Authorization: `Bot ${botToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(commandDefinitions),
});

if (!res.ok) {
  console.error(`Failed to register commands: ${res.status} ${await res.text()}`);
  process.exit(1);
}

const registered = (await res.json()) as { name: string }[];
console.log(`Registered ${registered.length} commands: ${registered.map((c) => c.name).join(", ")}`);
