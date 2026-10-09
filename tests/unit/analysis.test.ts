import { describe, expect, it } from "vitest";
import { scoreOfferConfidence } from "@/lib/analysis/confidence";
import { summarizePoints } from "@/lib/analysis/history";
import { pickReferenceCents, potentialSavingCents } from "@/lib/analysis/references";
import { selectWithQuotas } from "@/lib/monitoring/selection";
import { summarizeShoppingList } from "@/lib/analysis/shopping";
import { filterProducts, paginate, sortProducts } from "@/lib/analysis/product-query";
import { buildSeries } from "@/lib/analysis/series";
import type { QueryableProduct } from "@/lib/analysis/product-query";

const NOW = new Date("2026-10-09T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("histórico e métricas", () => {
  it("calcula atual, menor, maior, média e variação do período", () => {
    const s = summarizePoints([
      { priceCents: 10_000, collectedAt: day(10) },
      { priceCents: 8_000, collectedAt: day(5) },
      { priceCents: 9_000, collectedAt: day(1) },
    ]);
    expect(s.count).toBe(3);
    expect(s.min?.priceCents).toBe(8_000);
    expect(s.min?.collectedAt.getTime()).toBe(day(5).getTime());
    expect(s.max?.priceCents).toBe(10_000);
    expect(s.current?.priceCents).toBe(9_000);
    expect(s.averageCents).toBe(9_000);
    expect(s.variationPercent).toBeCloseTo(-10, 5);
  });

  it("sem pontos retorna nulos", () => {
    const s = summarizePoints([]);
    expect(s.count).toBe(0);
    expect(s.min).toBeNull();
    expect(s.variationPercent).toBeNull();
  });

  it("série do gráfico alinha lojas pelo instante de coleta", () => {
    const t = day(1);
    const { data, series } = buildSeries([
      { collectedAt: t, storeSlug: "a", storeName: "Loja A", comparableCents: 100 },
      { collectedAt: t, storeSlug: "b", storeName: "Loja B", comparableCents: 120 },
      { collectedAt: day(2), storeSlug: "a", storeName: "Loja A", comparableCents: 110 },
    ]);
    expect(series.map((s) => s.key)).toEqual(["a", "b"]);
    expect(data).toHaveLength(2);
    expect(data[0].t).toBe(day(2).getTime());
    expect(data[1]).toMatchObject({ a: 100, b: 120 });
  });
});

describe("referências e economia potencial", () => {
  it("modo manual usa o valor informado", () => {
    expect(pickReferenceCents("manual", { manualReferenceCents: 50_000, points: [], now: NOW })).toBe(50_000);
  });

  it("economia potencial é referência menos preço atual, nunca negativa", () => {
    expect(potentialSavingCents(50_000, 40_000)).toBe(10_000);
    expect(potentialSavingCents(40_000, 50_000)).toBeLessThanOrEqual(0);
    expect(potentialSavingCents(null, 40_000)).toBeNull();
  });
});

describe("indicador de confiança (sem classificar fraude)", () => {
  const base = {
    source: "api" as const,
    priceCents: 40_000,
    shippingKnown: true,
    matchStatus: "confirmado" as const,
    lastSuccessAt: NOW,
    now: NOW,
    intervalHours: 6,
    staleAfterIntervals: 2,
    validHistoryCount: 10,
    availability: "disponivel" as const,
    consecutiveFailures: 0,
    medianPriceCents: 42_000,
  };

  it("oferta fresca, confirmada e com histórico tem confiança alta", () => {
    const r = scoreOfferConfidence(base);
    expect(r.level).toBe("alta");
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it("histórico insuficiente, falhas recentes e preço desatualizado reduzem a confiança", () => {
    const r = scoreOfferConfidence({
      ...base,
      validHistoryCount: 0,
      consecutiveFailures: 3,
      lastSuccessAt: day(3),
      matchStatus: "pendente",
      shippingKnown: false,
    });
    expect(r.level).not.toBe("alta");
    expect(r.score).toBeLessThan(scoreOfferConfidence(base).score);
  });

  it("queda expressiva gera aviso para confirmar, sem marcar como fraude", () => {
    const r = scoreOfferConfidence({ ...base, priceCents: 10_000, medianPriceCents: 40_000 });
    expect(r.reasons.join(" ").toLowerCase()).not.toContain("fraude");
    expect(r.reasons.join(" ")).toContain("confirme");
    expect(r.level).toBe("media");
  });
});

describe("seleção de ofertas com limites por fonte", () => {
  it("nunca ultrapassa o limite por loja nem o lote", () => {
    const candidates = Array.from({ length: 12 }, (_, i) => ({
      offerId: `o${i}`,
      storeSlug: i < 8 ? "mercado-livre" : "magalu",
      priority: 1,
      lastCheckedAt: day(i + 1),
    }));
    const { selected, deferred } = selectWithQuotas(candidates, 6, 3);
    expect(selected.length).toBeLessThanOrEqual(6);
    expect(selected.filter((c) => c.storeSlug === "mercado-livre").length).toBeLessThanOrEqual(3);
    expect(selected.length + deferred).toBe(candidates.length);
  });

  it("prioriza ofertas nunca consultadas e depois a mais antiga", () => {
    const { selected } = selectWithQuotas(
      [
        { offerId: "recente", storeSlug: "a", priority: 0, lastCheckedAt: day(0) },
        { offerId: "nunca", storeSlug: "a", priority: 2, lastCheckedAt: null },
        { offerId: "antiga", storeSlug: "a", priority: 0, lastCheckedAt: day(9) },
      ],
      2,
      10,
    );
    expect(selected.map((c) => c.offerId)).toEqual(["nunca", "antiga"]);
  });
});

describe("lista de compras", () => {
  it("separa economia potencial de realizada e calcula orçamento restante", () => {
    const s = summarizeShoppingList(
      [
        { quantity: 2, status: "monitorando", plannedUnitBudgetCents: 10_000, maxBudgetCents: null, targetPriceCents: 9_000, bestComparableCents: 8_000, referenceCents: 10_000 },
        { quantity: 1, status: "comprado", plannedUnitBudgetCents: 5_000, maxBudgetCents: null, targetPriceCents: null, bestComparableCents: 4_500, referenceCents: 5_000 },
      ],
      [{ quantity: 1, paidUnitCents: 4_500, paidShippingCents: 0, realizedSavingCents: 500 }],
      20_000,
    );
    expect(s.potentialSavingCents).toBe(4_000);
    expect(s.realizedSavingCents).toBe(500);
    expect(s.purchasedTotalCents).toBe(4_500);
    expect(s.remainingBudgetCents).toBe(15_500);
    expect(s.reachedGoalsCount).toBe(2);
  });
});

describe("busca, filtros, ordenação e paginação de produtos", () => {
  const base = { brand: null, model: null, manufacturerCode: null, gtin: null };
  const items: QueryableProduct[] = [
    { ...base, id: "1", name: "Air fryer Philco", category: "Cozinha", status: "monitorando", priority: "alta", bestComparableCents: 40_000, savingCents: 5_000, dropPercent: 10, lastCollectedAt: day(1), storeSlugs: ["mercado-livre"] },
    { ...base, id: "2", name: "Ferro de passar", category: "Lavanderia", status: "pausado", priority: "baixa", bestComparableCents: 9_000, savingCents: null, dropPercent: null, lastCollectedAt: null, storeSlugs: ["magalu"] },
    { ...base, id: "3", name: "Cafeteira Oster", category: "Cozinha", status: "monitorando", priority: "media", bestComparableCents: 25_000, savingCents: 0, dropPercent: 0, lastCollectedAt: day(3), storeSlugs: ["mercado-livre", "magalu"] },
  ];

  it("busca sem acento e filtra por categoria e faixa de preço", () => {
    const r = filterProducts(items, { q: "AIR", category: "Cozinha", minPriceCents: 30_000 });
    expect(r.map((i) => i.id)).toEqual(["1"]);
  });

  it("filtra por loja e status", () => {
    const r = filterProducts(items, { store: "magalu", status: "pausado" });
    expect(r.map((i) => i.id)).toEqual(["2"]);
  });

  it("ordena por preço e pagina", () => {
    const sorted = sortProducts(items, "melhor_preco", "asc");
    expect(sorted.map((i) => i.id)).toEqual(["2", "3", "1"]);
    const page = paginate(sorted, 2, 2);
    expect(page.total).toBe(3);
    expect(page.totalPages).toBe(2);
    expect(page.items.map((i) => i.id)).toEqual(["1"]);
  });
});
