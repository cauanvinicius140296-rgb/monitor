export const PERIOD_KEYS = ["24h", "7d", "30d", "90d", "all"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  "24h": "Últimas 24 horas",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  "90d": "Últimos 90 dias",
  all: "Todo o histórico",
};

const HOUR = 60 * 60 * 1000;
const PERIOD_MS: Record<Exclude<PeriodKey, "all">, number> = {
  "24h": 24 * HOUR,
  "7d": 7 * 24 * HOUR,
  "30d": 30 * 24 * HOUR,
  "90d": 90 * 24 * HOUR,
};

export function parsePeriod(value: string | string[] | undefined): PeriodKey {
  const v = Array.isArray(value) ? value[0] : value;
  return (PERIOD_KEYS as readonly string[]).includes(v ?? "") ? (v as PeriodKey) : "30d";
}

/** Início do período (null = sem limite, "todo o histórico"). */
export function periodStart(period: PeriodKey, now: Date): Date | null {
  if (period === "all") return null;
  return new Date(now.getTime() - PERIOD_MS[period]);
}

export function periodDays(period: PeriodKey): number | null {
  return period === "all" ? null : PERIOD_MS[period] / (24 * HOUR);
}
