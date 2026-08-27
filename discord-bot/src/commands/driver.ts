import type { CommandHandler } from "./types.ts";
import { getSubcommand, optString } from "../discord/types.ts";
import { resolveDriver, fetchMemberInfo, fetchMemberSummary } from "../lib/iracingLookups.ts";
import { BRAND_COLOR, licenseLetter } from "../lib/format.ts";

export const driverCommand: CommandHandler = async (interaction, env) => {
  const { options } = getSubcommand(interaction.data!);
  const query = optString(options, "driver");
  if (!query) return { content: "A driver is required." };

  const driver = await resolveDriver(env, query);
  const [info, summary] = await Promise.all([
    fetchMemberInfo(env, driver.custId).catch(() => null),
    fetchMemberSummary(env, driver.custId).catch(() => null),
  ]);

  const licenses: any[] = info?.licenses ?? [];
  const fields = licenses.slice(0, 6).map((l) => ({
    name: l.category_name ?? l.category ?? "License",
    value: `${licenseLetter(l.group_id ?? l.license_level)} ${(l.safety_rating ?? 0).toFixed(2)} · iR ${l.irating ?? "—"}`,
    inline: true,
  }));

  return {
    embeds: [
      {
        title: driver.displayName,
        url: `https://members.iracing.com/membersite/member/CareerStats.do?custid=${driver.custId}`,
        color: BRAND_COLOR,
        fields: fields.length
          ? fields
          : [{ name: "License", value: "No license data available.", inline: false }],
        footer: summary
          ? { text: `${summary.this_year?.num_official_sessions ?? summary.wins ?? 0} official sessions this year` }
          : undefined,
      },
    ],
  };
};
