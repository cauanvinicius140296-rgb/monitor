import { eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { offers, products, stores } from "@/db/schema";
import { sortOffersForComparison } from "../analysis/comparison";
import { scoreOfferConfidence, type ConfidenceResult } from "../analysis/confidence";
import { pickReferenceFromAggregates, potentialSavingCents, type ReferenceMode } from "../analysis/references";
import { percentDrop } from "../money";
import type { AppSettings } from "../settings-defaults";
import { comparableCents } from "../monitoring/observations";

export interface OfferView {
  id: string;
  storeId: string;
  storeSlug: string;
  storeName: string;
  storeAutomated: boolean;
  storeIntegrationMode: "api" | "manual" | "pendente";
  url: string;
  externalId: string | null;
  title: string | null;
  imageUrl: string | null;
  sellerName: string | null;
  priceCents: number | null;
  shippingCents: number | null;
  shippingKnown: boolean;
  comparableCents: number | null;
  availability: "disponivel" | "indisponivel" | "desconhecido";
  matchStatus: "confirmado" | "pendente" | "divergente";
  matchNotes: string | null;
  isActive: boolean;
  source: "api" | "manual" | "demo";
  lastCheckedAt: Date | null;
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
  consecutiveFailures: number;
  stale: boolean;
  validHistoryCount: number;
  confidence: ConfidenceResult;
}

export interface ProductView {
  id: string;
  name: string;
  category: string;
  subcategory: string | null;
  brand: string | null;
  model: string | null;
  manufacturerCode: string | null;
  gtin: string | null;
  imageUrl: string | null;
  referenceUrl: string | null;
  targetPriceCents: number | null;
  maxBudgetCents: number | null;
  referencePriceCents: number | null;
  notes: string | null;
  priority: "alta" | "media" | "baixa";
  status: "monitorando" | "comprado" | "pausado" | "arquivado";
  createdAt: Date;
  updatedAt: Date;
  offers: OfferView[];
  activeOffers: number;
  storeSlugs: string[];
  best: OfferView | null;
  bestComparableCents: number | null;
  lastCollectedAt: Date | null;
  staleOffers: number;
  /** Queda do melhor preço frente ao maior valor observado na janela configurada (%). */
  dropPercent: number | null;
  /** Menor preço observado pelo sistema (todo o histórico) e a data em que ocorreu. */
  minObservedCents: number | null;
  minObservedAt: Date | null;
  maxObservedCents: number | null;
  validHistoryCount: number;
  /** Preço de referência conforme a política escolhida nas configurações. */
  referenceCents: number | null;
  savingCents: number | null;
  targetReached: boolean;
  budgetReached: boolean;
}

export interface CatalogFilter {
  statuses?: ProductView["status"][];
  includeArchived?: boolean;
  productIds?: string[];
}

interface Aggregate {
  productId: string;
  count: number;
  minCents: number | null;
  max90Cents: number | null;
  maxWindowCents: number | null;
  lastAt: Date | null;
}

/** Valor comparável (preço + frete quando conhecido). Usa o alias `ph` das consultas brutas. */
const COMPARABLE_SQL = sql.raw("CASE WHEN ph.shipping_known AND ph.total_cents IS NOT NULL THEN ph.total_cents ELSE ph.price_cents END");

/** Lista de parâmetros para `IN (...)` (arrays cruzos não funcionam com sql`= any(...)` no driver). */
const idList = (ids: string[]) => sql.join(ids.map((id) => sql`${id}`), sql`, `);

/**
 * Carrega o catálogo consolidado: produtos, ofertas, melhor oferta, referências e agregados
 * do histórico. Usado pelo painel, pela tabela de produtos, pela lista de compras e pelos alertas.
 */
export async function loadCatalog(
  db: Db,
  args: { now: Date; settings: AppSettings; filter?: CatalogFilter },
): Promise<ProductView[]> {
  const { now, settings, filter = {} } = args;

  const productRows = await db
    .select()
    .from(products)
    .where(filter.productIds?.length ? inArray(products.id, filter.productIds) : sql`true`);

  const selected = productRows.filter((p) => {
    if (filter.statuses?.length) return filter.statuses.includes(p.status);
    if (!filter.includeArchived && p.status === "arquivado") return false;
    return true;
  });
  if (selected.length === 0) return [];
  const ids = selected.map((p) => p.id);

  const offerRows = await db
    .select({
      id: offers.id,
      productId: offers.productId,
      storeId: offers.storeId,
      storeSlug: stores.slug,
      storeName: stores.name,
      storeAutomated: stores.automated,
      storeIntegrationMode: stores.integrationMode,
      url: offers.url,
      externalId: offers.externalId,
      title: offers.title,
      imageUrl: offers.imageUrl,
      sellerName: offers.sellerName,
      priceCents: offers.currentPriceCents,
      shippingCents: offers.currentShippingCents,
      shippingKnown: offers.shippingKnown,
      availability: offers.currentAvailability,
      matchStatus: offers.matchStatus,
      matchNotes: offers.matchNotes,
      isActive: offers.isActive,
      source: offers.source,
      lastCheckedAt: offers.lastCheckedAt,
      lastSuccessAt: offers.lastSuccessAt,
      lastErrorAt: offers.lastErrorAt,
      lastError: offers.lastError,
      consecutiveFailures: offers.consecutiveFailures,
    })
    .from(offers)
    .innerJoin(stores, eq(offers.storeId, stores.id))
    .where(inArray(offers.productId, ids));

  const maxAgeMs = settings.intervalHours * settings.staleAfterIntervals * 3_600_000;
  const windowStart = new Date(now.getTime() - settings.dropWindowDays * 24 * 3_600_000);
  const d90 = new Date(now.getTime() - 90 * 24 * 3_600_000);

  const aggRows = await db.execute<{
    product_id: string;
    n: number;
    min_cents: number | null;
    max90: number | null;
    max_window: number | null;
    last_at: Date | null;
  }>(sql`
    SELECT ph.product_id,
           count(*)::int AS n,
           min(${COMPARABLE_SQL}) AS min_cents,
           max(${COMPARABLE_SQL}) FILTER (WHERE ph.collected_at >= ${d90.toISOString()}::timestamptz) AS max90,
           max(${COMPARABLE_SQL}) FILTER (WHERE ph.collected_at >= ${windowStart.toISOString()}::timestamptz) AS max_window,
           max(ph.collected_at) AS last_at
    FROM price_history ph
    WHERE ph.status = 'sucesso' AND ph.price_cents IS NOT NULL
      AND ph.product_id IN (${idList(ids)})
    GROUP BY ph.product_id
  `);
  const aggs = new Map<string, Aggregate>();
  for (const r of aggRows) {
    aggs.set(r.product_id, {
      productId: r.product_id,
      count: Number(r.n),
      minCents: r.min_cents === null ? null : Number(r.min_cents),
      max90Cents: r.max90 === null ? null : Number(r.max90),
      maxWindowCents: r.max_window === null ? null : Number(r.max_window),
      lastAt: r.last_at ? new Date(r.last_at) : null,
    });
  }

  // Menor preço (primeira ocorrência) e primeiro preço observado de cada produto.
  const minRows = await db.execute<{ product_id: string; comp: number; collected_at: Date }>(sql`
    SELECT DISTINCT ON (ph.product_id) ph.product_id, ${COMPARABLE_SQL} AS comp, ph.collected_at
    FROM price_history ph
    WHERE ph.status = 'sucesso' AND ph.price_cents IS NOT NULL AND ph.product_id IN (${idList(ids)})
    ORDER BY ph.product_id, comp ASC, ph.collected_at ASC
  `);
  const minMap = new Map(minRows.map((r) => [r.product_id, { cents: Number(r.comp), at: new Date(r.collected_at) }]));

  const firstRows = await db.execute<{ product_id: string; comp: number }>(sql`
    SELECT DISTINCT ON (ph.product_id) ph.product_id, ${COMPARABLE_SQL} AS comp
    FROM price_history ph
    WHERE ph.status = 'sucesso' AND ph.price_cents IS NOT NULL AND ph.product_id IN (${idList(ids)})
    ORDER BY ph.product_id, ph.collected_at ASC
  `);
  const firstMap = new Map(firstRows.map((r) => [r.product_id, Number(r.comp)]));

  const maxAllRows = await db.execute<{ product_id: string; mx: number }>(sql`
    SELECT ph.product_id, max(${COMPARABLE_SQL}) AS mx
    FROM price_history ph
    WHERE ph.status = 'sucesso' AND ph.price_cents IS NOT NULL AND ph.product_id IN (${idList(ids)})
    GROUP BY ph.product_id
  `);
  const maxAllMap = new Map(maxAllRows.map((r) => [r.product_id, Number(r.mx)]));

  const offersByProduct = new Map<string, OfferView[]>();
  for (const o of offerRows) {
    const comp = comparableCents(o.priceCents, o.shippingCents, o.shippingKnown);
    const stale =
      o.isActive && (!o.lastSuccessAt || now.getTime() - new Date(o.lastSuccessAt).getTime() > maxAgeMs);
    const agg = aggs.get(o.productId);
    const confidence = scoreOfferConfidence({
      source: o.source,
      priceCents: o.priceCents,
      shippingKnown: o.shippingKnown,
      matchStatus: o.matchStatus,
      lastSuccessAt: o.lastSuccessAt,
      now,
      intervalHours: settings.intervalHours,
      staleAfterIntervals: settings.staleAfterIntervals,
      validHistoryCount: agg?.count ?? 0,
      availability: o.availability,
      consecutiveFailures: o.consecutiveFailures,
    });
    const view: OfferView = {
      id: o.id,
      storeId: o.storeId,
      storeSlug: o.storeSlug,
      storeName: o.storeName,
      storeAutomated: o.storeAutomated,
      storeIntegrationMode: o.storeIntegrationMode,
      url: o.url,
      externalId: o.externalId,
      title: o.title,
      imageUrl: o.imageUrl,
      sellerName: o.sellerName,
      priceCents: o.priceCents,
      shippingCents: o.shippingCents,
      shippingKnown: o.shippingKnown,
      comparableCents: comp,
      availability: o.availability,
      matchStatus: o.matchStatus,
      matchNotes: o.matchNotes,
      isActive: o.isActive,
      source: o.source,
      lastCheckedAt: o.lastCheckedAt,
      lastSuccessAt: o.lastSuccessAt,
      lastErrorAt: o.lastErrorAt,
      lastError: o.lastError,
      consecutiveFailures: o.consecutiveFailures,
      stale: stale ?? false,
      validHistoryCount: agg?.count ?? 0,
      confidence,
    };
    const list = offersByProduct.get(o.productId) ?? [];
    list.push(view);
    offersByProduct.set(o.productId, list);
  }

  return selected.map((p): ProductView => {
    // Comparação: menor preço total primeiro (quando conhecido); sem preço e divergentes depois.
    const offers_ = sortOffersForComparison(offersByProduct.get(p.id) ?? []);
    const active = offers_.filter((o) => o.isActive);
    const candidates = active.filter(
      (o) => o.comparableCents !== null && o.matchStatus !== "divergente" && o.availability !== "indisponivel",
    );
    const best = candidates.reduce<OfferView | null>((acc, cur) => {
      if (!acc) return cur;
      if ((cur.comparableCents ?? Infinity) < (acc.comparableCents ?? Infinity)) return cur;
      return acc;
    }, null);
    const agg = aggs.get(p.id);
    const bestComp = best?.comparableCents ?? null;
    const lastCollected = offers_
      .map((o) => o.lastSuccessAt)
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const minEntry = minMap.get(p.id) ?? null;
    const referenceCents = pickReferenceFromAggregates(settings.referenceMode as ReferenceMode, {
      manualReferenceCents: p.referencePriceCents,
      maxLast90dCents: agg?.max90Cents ?? null,
      firstObservedCents: firstMap.get(p.id) ?? null,
    });
    return {
      id: p.id,
      name: p.name,
      category: p.category,
      subcategory: p.subcategory,
      brand: p.brand,
      model: p.model,
      manufacturerCode: p.manufacturerCode,
      gtin: p.gtin,
      imageUrl: p.imageUrl,
      referenceUrl: p.referenceUrl,
      targetPriceCents: p.targetPriceCents,
      maxBudgetCents: p.maxBudgetCents,
      referencePriceCents: p.referencePriceCents,
      notes: p.notes,
      priority: p.priority,
      status: p.status,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      offers: offers_,
      activeOffers: active.length,
      storeSlugs: [...new Set(active.map((o) => o.storeSlug))],
      best,
      bestComparableCents: bestComp,
      lastCollectedAt: lastCollected,
      staleOffers: active.filter((o) => o.stale || !o.lastSuccessAt).length,
      dropPercent: agg?.maxWindowCents && bestComp !== null ? percentDrop(agg.maxWindowCents, bestComp) : null,
      minObservedCents: minEntry?.cents ?? null,
      minObservedAt: minEntry?.at ?? null,
      maxObservedCents: maxAllMap.get(p.id) ?? null,
      validHistoryCount: agg?.count ?? 0,
      referenceCents,
      savingCents: potentialSavingCents(referenceCents, bestComp),
      targetReached: p.targetPriceCents !== null && bestComp !== null && bestComp <= p.targetPriceCents,
      budgetReached: p.maxBudgetCents !== null && bestComp !== null && bestComp <= p.maxBudgetCents,
    };
  });
}

