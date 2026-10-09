/**
 * Monta a série do gráfico: uma linha por loja, com pontos alinhados por instante de coleta.
 * Função pura, reutilizada na página do produto.
 */
export interface SeriesInput {
  collectedAt: Date;
  storeSlug: string;
  storeName: string;
  comparableCents: number;
}

export interface ChartRow {
  t: number;
  [storeSlug: string]: number | null;
}

export function buildSeries(points: SeriesInput[]): { data: ChartRow[]; series: { key: string; label: string }[] } {
  const seriesMap = new Map<string, string>();
  const rows = new Map<number, ChartRow>();
  for (const p of points) {
    seriesMap.set(p.storeSlug, p.storeName);
    const t = p.collectedAt.getTime();
    const row = rows.get(t) ?? { t };
    row[p.storeSlug] = p.comparableCents;
    rows.set(t, row);
  }
  const data = [...rows.values()].sort((a, b) => a.t - b.t);
  const series = [...seriesMap.entries()].map(([key, label]) => ({ key, label }));
  return { data, series };
}
