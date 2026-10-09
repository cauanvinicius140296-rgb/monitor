/**
 * Seleção de ofertas para uma execução, com limites por fonte (função pura).
 */
export interface Candidate {
  offerId: string;
  storeSlug: string;
  priority: number; // 0 = alta, 1 = média, 2 = baixa
  lastCheckedAt: Date | null;
}

/**
 * Ordena por: nunca consultadas primeiro, depois a consulta mais antiga,
 * depois prioridade do produto. Aplica o limite global e o limite por loja.
 */
export function selectWithQuotas<T extends Candidate>(
  candidates: T[],
  batchSize: number,
  maxPerStore: number,
): { selected: T[]; deferred: number } {
  const ordered = [...candidates].sort((a, b) => {
    const at = a.lastCheckedAt?.getTime() ?? -Infinity;
    const bt = b.lastCheckedAt?.getTime() ?? -Infinity;
    if (at !== bt) return at - bt;
    return a.priority - b.priority;
  });
  const perStore = new Map<string, number>();
  const selected: T[] = [];
  for (const c of ordered) {
    if (selected.length >= batchSize) break;
    const used = perStore.get(c.storeSlug) ?? 0;
    if (used >= maxPerStore) continue;
    perStore.set(c.storeSlug, used + 1);
    selected.push(c);
  }
  return { selected, deferred: ordered.length - selected.length };
}

/** Pausa com cancelamento simples (usada entre requisições à mesma fonte). */
export function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));
}
