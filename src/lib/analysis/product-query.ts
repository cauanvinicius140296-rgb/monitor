/**
 * Busca, filtros, ordenação e paginação da tabela de produtos (função pura).
 */
import { normalizeText } from "./matching";

export type SortKey = "prioridade" | "nome" | "melhor_preco" | "economia" | "queda" | "atualizacao";

export interface ProductQuery {
  q?: string;
  category?: string;
  store?: string;
  priority?: string;
  status?: string;
  minPriceCents?: number | null;
  maxPriceCents?: number | null;
  sort?: SortKey;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface QueryableProduct {
  id: string;
  name: string;
  category: string;
  brand: string | null;
  model: string | null;
  manufacturerCode: string | null;
  gtin: string | null;
  priority: "alta" | "media" | "baixa";
  status: "monitorando" | "comprado" | "pausado" | "arquivado";
  storeSlugs: string[];
  bestComparableCents: number | null;
  savingCents: number | null;
  dropPercent: number | null;
  lastCollectedAt: Date | null;
}

const PRIORITY_RANK: Record<string, number> = { alta: 0, media: 1, baixa: 2 };

export function filterProducts<T extends QueryableProduct>(items: T[], q: ProductQuery): T[] {
  const term = normalizeText(q.q);
  return items.filter((p) => {
    if (q.status && q.status !== "todos") {
      if (p.status !== q.status) return false;
    } else if (!q.status || q.status === "todos") {
      if (q.status !== "todos" && p.status === "arquivado") return false;
    }
    if (term) {
      const haystack = normalizeText([p.name, p.brand, p.model, p.category, p.manufacturerCode, p.gtin].filter(Boolean).join(" "));
      if (!haystack.includes(term)) return false;
    }
    if (q.category && p.category !== q.category) return false;
    if (q.store && !p.storeSlugs.includes(q.store)) return false;
    if (q.priority && p.priority !== q.priority) return false;
    if (q.minPriceCents != null || q.maxPriceCents != null) {
      if (p.bestComparableCents === null) return false;
      if (q.minPriceCents != null && p.bestComparableCents < q.minPriceCents) return false;
      if (q.maxPriceCents != null && p.bestComparableCents > q.maxPriceCents) return false;
    }
    return true;
  });
}

function compareNullable(a: number | null, b: number | null, dir: 1 | -1): number {
  // Valores ausentes sempre por último, independentemente da direção.
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return (a - b) * dir;
}

export function sortProducts<T extends QueryableProduct>(items: T[], sort: SortKey = "nome", dir: "asc" | "desc" = "asc"): T[] {
  const d: 1 | -1 = dir === "desc" ? -1 : 1;
  const out = [...items];
  switch (sort) {
    case "prioridade":
      out.sort((a, b) => (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]) * d || a.name.localeCompare(b.name, "pt-BR"));
      break;
    case "melhor_preco":
      out.sort((a, b) => compareNullable(a.bestComparableCents, b.bestComparableCents, d));
      break;
    case "economia":
      out.sort((a, b) => compareNullable(a.savingCents, b.savingCents, d));
      break;
    case "queda":
      out.sort((a, b) => compareNullable(a.dropPercent, b.dropPercent, d));
      break;
    case "atualizacao":
      out.sort((a, b) => compareNullable(a.lastCollectedAt?.getTime() ?? null, b.lastCollectedAt?.getTime() ?? null, d));
      break;
    default:
      out.sort((a, b) => a.name.localeCompare(b.name, "pt-BR") * d);
  }
  return out;
}

export function paginate<T>(items: T[], page: number, pageSize: number): { items: T[]; page: number; totalPages: number; total: number } {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const start = (current - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), page: current, totalPages, total };
}

export function queryProducts<T extends QueryableProduct>(items: T[], q: ProductQuery) {
  const filtered = filterProducts(items, q);
  const sorted = sortProducts(filtered, q.sort, q.dir);
  return paginate(sorted, q.page ?? 1, q.pageSize ?? 25);
}
