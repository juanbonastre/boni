/**
 * The colours a chart can have: Boni Calendar's calendar palette (docs/design-guide.md in juanbonastre/boni-calendar),
 * the same list as the server's `PALETTE`. The name is a key of i18n (`color.<name>`).
 */
export const PALETTE: { name: string; hex: string }[] = [
  { name: "violet", hex: "#a78bfa" },
  { name: "orange", hex: "#fb923c" },
  { name: "coral", hex: "#f87171" },
  { name: "amber", hex: "#fbbf24" },
  { name: "green", hex: "#4ade80" },
  { name: "teal", hex: "#2dd4bf" },
  { name: "sky", hex: "#38bdf8" },
  { name: "blue", hex: "#60a5fa" },
  { name: "pink", hex: "#f472b6" },
  { name: "red", hex: "#ef4444" },
  { name: "slate", hex: "#94a3b8" },
];

/** Periods offered by a chart's period control (the editor has every kind, with their numbers). */
export const QUICK_PERIODS = [
  { kind: "this_month" },
  { kind: "last_month" },
  { kind: "last_months", months: 3 },
  { kind: "last_months", months: 6 },
  { kind: "last_months", months: 12 },
  { kind: "last_months", months: 24 },
  { kind: "this_year" },
  { kind: "last_year" },
  { kind: "all" },
] as const;

/** "Show only the N largest" choices of the sort control. */
export const TOP_CHOICES = [null, 5, 10, 20] as const;
