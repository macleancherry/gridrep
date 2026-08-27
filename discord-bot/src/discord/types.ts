export type InteractionOption = {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: InteractionOption[];
};

export type Interaction = {
  type: number;
  id: string;
  token: string;
  application_id: string;
  guild_id?: string;
  channel_id?: string;
  member?: { user: { id: string; username: string }; roles: string[] };
  user?: { id: string; username: string };
  data?: {
    name: string;
    options?: InteractionOption[];
  };
};

/** Flattens one level of subcommand nesting: {name: "laps", options: [{name: "qualifying", options: [...]}]}. */
export function getSubcommand(data: NonNullable<Interaction["data"]>): { name: string | null; options: Map<string, InteractionOption> } {
  const first = data.options?.[0];
  if (first && first.type === 1 /* SUB_COMMAND */) {
    const options = new Map((first.options ?? []).map((o) => [o.name, o]));
    return { name: first.name, options };
  }
  const options = new Map((data.options ?? []).map((o) => [o.name, o]));
  return { name: null, options };
}

export function optString(options: Map<string, InteractionOption>, name: string): string | undefined {
  const v = options.get(name)?.value;
  return typeof v === "string" ? v : undefined;
}

export function optNumber(options: Map<string, InteractionOption>, name: string): number | undefined {
  const v = options.get(name)?.value;
  return typeof v === "number" ? v : undefined;
}

export function optBoolean(options: Map<string, InteractionOption>, name: string): boolean | undefined {
  const v = options.get(name)?.value;
  return typeof v === "boolean" ? v : undefined;
}

export function requesterId(interaction: Interaction): string | undefined {
  return interaction.member?.user.id ?? interaction.user?.id;
}

export function isGuildAdmin(interaction: Interaction, adminRoleId: string | null): boolean {
  if (!interaction.member) return false;
  // Discord's PERMISSIONS flag for Administrator isn't in `member`, so we
  // rely on the configured admin role; server owners/actual admins already
  // pass because `default_member_permissions: "0"` on admin commands
  // restricts them to Manage Guild by default until /setup admin_role runs.
  if (!adminRoleId) return true;
  return interaction.member.roles.includes(adminRoleId);
}
