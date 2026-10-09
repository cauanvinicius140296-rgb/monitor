import { desc, eq, gt, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { alerts, monitoringRuns, priceHistory, products, stores } from "@/db/schema";
import { loadCatalog, type ProductView } from "./catalog";
import type { AppSettings } from "../settings-defaults";
import { REFERENCE_MODES } from "../analysis/references";

export interface DashboardData {
  monitored: number;
  activeOffers: number;
  targetReached: ProductView[];
  budgetReached: ProductView[];
  recentDrops: ProductView[];
  potentialSavingCents: number;
  productsWithSaving: number;
  staleProducts: ProductView[];
  staleOffersCount: number;
  failingStores: { name: string; slug: string; consecutiveFailures: number; lastError: string | null; lastFailureAt: Date | null }[];
  recentUpdates: {
    collectedAt: Date;
    productId: string;
    productName: string;
    storeName: string;
    status: string;
    priceCents: number | null;
    errorMessage: string | null;
  }[];
  recentRuns: { id: string; trigger: string; status: string; startedAt: Date; ok: number; failed: number; selected: number }[];
  recentAlerts: { id: string; title: string; status: string; createdAt: Date; productId: string; observedPriceCents: number | null }[];
  unreadAlerts: number;
  referenceMode: AppSettings["referenceMode"];
  dropThresholdPercent: number;
  dropWindowDays: number;
}

export async function loadDashboard(db: Db, now: Date, settings: AppSettings): Promise<DashboardData> {
  const catalog = await loadCatalog(db, { now, settings, filter: { statuses: ["monitorando"] } });
  const targetReached = catalog.filter((p) => p.targetReached);
  const budgetReached = catalog.filter((p) => p.budgetReached && !p.targetReached);
  const recentDrops = catalog
    .filter((p) => p.dropPercent !== null && p.dropPercent >= settings.dropThresholdPercent)
    .sort((a, b) => (b.dropPercent ?? 0) - (a.dropPercent ?? 0));
  const withSaving = catalog.filter((p) => p.savingCents !== null && p.savingCents > 0);
  const staleProducts = catalog.filter((p) => p.staleOffers > 0);

  const failingStores = await db
    .select({
      name: stores.name,
      slug: stores.slug,
      consecutiveFailures: stores.consecutiveFailures,
      lastError: stores.lastError,
      lastFailureAt: stores.lastFailureAt,
    })
    .from(stores)
    .where(gt(stores.consecutiveFailures, 0))
    .orderBy(desc(stores.consecutiveFailures));

  const updates = await db
    .select({
      collectedAt: priceHistory.collectedAt,
      productId: priceHistory.productId,
      productName: products.name,
      storeName: stores.name,
      status: priceHistory.status,
      priceCents: priceHistory.priceCents,
      errorMessage: priceHistory.errorMessage,
    })
    .from(priceHistory)
    .innerJoin(products, eq(priceHistory.productId, products.id))
    .innerJoin(stores, eq(priceHistory.storeId, stores.id))
    .orderBy(desc(priceHistory.collectedAt))
    .limit(12);

  const runs = await db
    .select({
      id: monitoringRuns.id,
      trigger: monitoringRuns.trigger,
      status: monitoringRuns.status,
      startedAt: monitoringRuns.startedAt,
      ok: monitoringRuns.offersOk,
      failed: monitoringRuns.offersFailed,
      selected: monitoringRuns.offersSelected,
    })
    .from(monitoringRuns)
    .orderBy(desc(monitoringRuns.startedAt))
    .limit(6);

  const recentAlerts = await db
    .select({
      id: alerts.id,
      title: alerts.title,
      status: alerts.status,
      createdAt: alerts.createdAt,
      productId: alerts.productId,
      observedPriceCents: alerts.observedPriceCents,
    })
    .from(alerts)
    .orderBy(desc(alerts.createdAt))
    .limit(5);

  const [unread] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(alerts)
    .where(eq(alerts.status, "nao_lido"));

  return {
    monitored: catalog.length,
    activeOffers: catalog.reduce((acc, p) => acc + p.activeOffers, 0),
    targetReached,
    budgetReached,
    recentDrops: recentDrops.slice(0, 6),
    potentialSavingCents: withSaving.reduce((acc, p) => acc + (p.savingCents ?? 0), 0),
    productsWithSaving: withSaving.length,
    staleProducts: staleProducts.slice(0, 8),
    staleOffersCount: catalog.reduce((acc, p) => acc + p.staleOffers, 0),
    failingStores,
    recentUpdates: updates.map((u) => ({ ...u, collectedAt: new Date(u.collectedAt) })),
    recentRuns: runs.map((r) => ({ ...r, startedAt: new Date(r.startedAt) })),
    recentAlerts: recentAlerts.map((a) => ({ ...a, createdAt: new Date(a.createdAt) })),
    unreadAlerts: unread?.n ?? 0,
    referenceMode: REFERENCE_MODES.includes(settings.referenceMode) ? settings.referenceMode : "maior_90d",
    dropThresholdPercent: settings.dropThresholdPercent,
    dropWindowDays: settings.dropWindowDays,
  };
}
