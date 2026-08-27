export const BRAND_COLOR = 0x3b82f6;

export function iratingDeltaText(oldIr?: number | null, newIr?: number | null): string {
  if (oldIr == null || newIr == null) return "—";
  const delta = newIr - oldIr;
  const sign = delta > 0 ? "+" : "";
  return `${newIr} (${sign}${delta})`;
}

export function srDeltaText(oldSr?: number | null, newSr?: number | null): string {
  if (oldSr == null || newSr == null) return "—";
  const delta = (newSr - oldSr) / 100;
  const sign = delta > 0 ? "+" : "";
  return `${(newSr / 100).toFixed(2)} (${sign}${delta.toFixed(2)})`;
}

const LICENSE_LETTERS: Record<number, string> = { 1: "R", 2: "D", 3: "C", 4: "B", 5: "A", 6: "P" };

export function licenseLetter(licenseGroup?: number | null): string {
  return LICENSE_LETTERS[licenseGroup ?? -1] ?? "?";
}

export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

export function formatLapTime(hundredthsOrMs?: number | null): string {
  if (hundredthsOrMs == null || hundredthsOrMs < 0) return "—";
  // iRacing lap times are typically given in 1/10000 sec.
  const totalSeconds = hundredthsOrMs / 10000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = (totalSeconds - minutes * 60).toFixed(3);
  return `${minutes}:${seconds.padStart(6, "0")}`;
}

export function truncateList<T>(items: T[], max: number): T[] {
  return items.slice(0, max);
}
