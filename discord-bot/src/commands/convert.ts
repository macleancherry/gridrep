import type { CommandHandler } from "./types.ts";
import { getSubcommand, optNumber, optString } from "../discord/types.ts";
import { BRAND_COLOR } from "../lib/format.ts";

function convertTemperature(value: number, from: string): { result: number; toUnit: string } {
  return from === "c" ? { result: value * (9 / 5) + 32, toUnit: "°F" } : { result: ((value - 32) * 5) / 9, toUnit: "°C" };
}

function convertVolume(value: number, from: string): { result: number; toUnit: string } {
  return from === "l" ? { result: value / 3.785411784, toUnit: "gal" } : { result: value * 3.785411784, toUnit: "L" };
}

function convertSpeed(value: number, from: string): { result: number; toUnit: string } {
  return from === "kph" ? { result: value / 1.609344, toUnit: "mph" } : { result: value * 1.609344, toUnit: "km/h" };
}

export const convertCommand: CommandHandler = async (interaction) => {
  const { name, options } = getSubcommand(interaction.data!);
  const value = optNumber(options, "value");
  const from = optString(options, "from");
  if (value == null || !from) return { content: "A value and unit are required." };

  let converted: { result: number; toUnit: string };
  switch (name) {
    case "temperature":
      converted = convertTemperature(value, from);
      break;
    case "volume":
      converted = convertVolume(value, from);
      break;
    case "speed":
      converted = convertSpeed(value, from);
      break;
    default:
      return { content: "Unknown /convert subcommand." };
  }

  return {
    embeds: [
      {
        description: `**${value}** → **${converted.result.toFixed(2)} ${converted.toUnit}**`,
        color: BRAND_COLOR,
      },
    ],
  };
};
