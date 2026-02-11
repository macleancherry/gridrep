export const PROP_REASONS = [
  { id: "clean_battle", label: "Clean battle" },
  { id: "respectful_driving", label: "Respectful driving" },
  { id: "great_racecraft", label: "Great racecraft" },
  { id: "good_etiquette", label: "Good etiquette" },
  { id: "helpful_friendly", label: "Helpful / friendly" },
  { id: "other", label: "Other" },
] as const;

export type PropReasonId = (typeof PROP_REASONS)[number]["id"];
