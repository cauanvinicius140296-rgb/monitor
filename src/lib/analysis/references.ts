/**
 * Preço de referência usado para calcular economia potencial.
 * O usuário escolhe a política no painel (configurações).
 */
import type { PricePoint } from "./history";

export const REFERENCE_MODES = ["manual", "maior_90d", "primeiro_observado"] as const;
export type ReferenceMode = (typeof REFERENCE_MODES)[number];

export const REFERENCE_LABELS: Record<ReferenceMode, string> = {
  manual: "Preço de referência informado no produto",
  maior_90d: "Maior preço observado nos últimos 90 dias",
  primeiro_observado: "Primeiro preço observado pelo sistema",
};

export interface ReferenceInput {
  manualReferenceCents: number | null;
  points: PricePoint[];
  now: Date;
}

export function pickReferenceCents(mode: ReferenceMode, input: ReferenceInput): number | null {
  if (mode === "manual") return input.manualReferenceCents;
  if (mode === "primeiro_observado") {
    if (input.points.length === 0) return null;
    const first = [...input.points].sort((a, b) => a.collectedAt.getTime() - b.collectedAt.getTime())[0];
    return first.priceCents;
  }
  const since = new Date(input.now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const recent = input.points.filter((p) => p.collectedAt >= since);
  if (recent.length === 0) return null;
  return Math.max(...recent.map((p) => p.priceCents));
}

/** Economia potencial por unidade (nunca negativa). */
export function potentialSavingCents(referenceCents: number | null, currentCents: number | null): number | null {
  if (referenceCents === null || currentCents === null) return null;
  return Math.max(0, referenceCents - currentCents);
}

export interface ReferenceAggregates {
  manualReferenceCents: number | null;
  maxLast90dCents: number | null;
  firstObservedCents: number | null;
}

/** Mesma regra de `pickReferenceCents`, a partir de agregados já calculados no banco. */
export function pickReferenceFromAggregates(mode: ReferenceMode, agg: ReferenceAggregates): number | null {
  if (mode === "manual") return agg.manualReferenceCents;
  if (mode === "primeiro_observado") return agg.firstObservedCents;
  return agg.maxLast90dCents;
}
