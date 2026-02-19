export const PROP_REASONS = [
  { id: "clean_battle", label: "Clean battle" },
  { id: "gave_racing_room", label: "Gave racing room" },
  { id: "great_move", label: "Great move (fair pass/defence)" },
  { id: "great_strategy", label: "Great strategy / race IQ" },
  { id: "sportsmanship", label: "Sportsmanship / Redressing" },
  { id: "great_drive", label: "Great drive (win/comeback/consistency)" },
] as const;

export type PropReasonId = (typeof PROP_REASONS)[number]["id"];
