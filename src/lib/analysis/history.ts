/**
 * Estatísticas do histórico de preços. Funções puras, sem acesso ao banco.
 * Importante: o "menor preço" é o menor observado PELO SISTEMA no período monitorado,
 * não necessariamente o menor preço do mercado.
 */

export interface PricePoint {
  priceCents: number;
  collectedAt: Date;
  storeId?: string;
  storeName?: string;
}

export interface HistorySummary {
  count: number;
  current: PricePoint | null;
  first: PricePoint | null;
  min: PricePoint | null;
  max: PricePoint | null;
  averageCents: number | null;
  /** Variação percentual do primeiro ao último ponto do período. */
  variationPercent: number | null;
}

export function summarizePoints(points: PricePoint[]): HistorySummary {
  const sorted = [...points].sort((a, b) => a.collectedAt.getTime() - b.collectedAt.getTime());
  if (sorted.length === 0) {
    return { count: 0, current: null, first: null, min: null, max: null, averageCents: null, variationPercent: null };
  }
  let min = sorted[0];
  let max = sorted[0];
  let sum = 0;
  for (const p of sorted) {
    // Em empates, mantemos a observação mais antiga como "data do menor preço".
    if (p.priceCents < min.priceCents) min = p;
    if (p.priceCents > max.priceCents) max = p;
    sum += p.priceCents;
  }
  const first = sorted[0];
  const current = sorted[sorted.length - 1];
  const variation =
    first.priceCents > 0 ? ((current.priceCents - first.priceCents) / first.priceCents) * 100 : null;
  return {
    count: sorted.length,
    current,
    first,
    min,
    max,
    averageCents: Math.round(sum / sorted.length),
    variationPercent: variation,
  };
}

/** Mediana de uma lista de valores em centavos. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? Math.round((s[mid - 1] + s[mid]) / 2) : s[mid];
}

/** Maior preço observado dentro de uma janela (para medir queda recente). */
export function maxInWindow(points: PricePoint[], since: Date): number | null {
  const inWindow = points.filter((p) => p.collectedAt >= since);
  if (inWindow.length === 0) return null;
  return Math.max(...inWindow.map((p) => p.priceCents));
}
