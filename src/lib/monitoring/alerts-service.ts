import { and, eq, ne, or, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { alertStates, alerts, offers, priceHistory, products, stores } from "@/db/schema";
import {
  evaluateAlerts,
  type EvalOffer,
  type EvalPoint,
  type EvalSettings,
  type EvalState,
  type AlertType,
} from "../analysis/alerts-engine";
import type { AppSettings } from "../settings-defaults";

/** Carrega o estado de avaliação de um produto e persiste as transições de alerta. */
export async function evaluateProductAlerts(
  db: Db,
  args: { productId: string; runId: string | null; now: Date; settings: AppSettings },
): Promise<{ created: number }> {
  const { productId, runId, now, settings } = args;
  const productRows = await db
    .select({
      id: products.id,
      name: products.name,
      status: products.status,
      targetPriceCents: products.targetPriceCents,
      maxBudgetCents: products.maxBudgetCents,
    })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  const product = productRows[0];
  if (!product || product.status === "arquivado") return { created: 0 };

  const offerRows = await db
    .select({
      offerId: offers.id,
      storeId: offers.storeId,
      storeName: stores.name,
      url: offers.url,
      priceCents: offers.currentPriceCents,
      shippingCents: offers.currentShippingCents,
      shippingKnown: offers.shippingKnown,
      availability: offers.currentAvailability,
      matchStatus: offers.matchStatus,
      lastSuccessAt: offers.lastSuccessAt,
      isActive: offers.isActive,
    })
    .from(offers)
    .innerJoin(stores, eq(offers.storeId, stores.id))
    .where(eq(offers.productId, productId));

  // Histórico anterior à coleta atual (exclui a execução corrente para não "comparar consigo mesmo").
  const historyRows = await db
    .select({
      priceCents: priceHistory.priceCents,
      totalCents: priceHistory.totalCents,
      shippingKnown: priceHistory.shippingKnown,
      collectedAt: priceHistory.collectedAt,
    })
    .from(priceHistory)
    .where(
      and(
        eq(priceHistory.productId, productId),
        eq(priceHistory.status, "sucesso"),
        sql`${priceHistory.priceCents} is not null`,
        runId ? or(isNull(priceHistory.runId), ne(priceHistory.runId, runId)) : sql`true`,
      ),
    );

  const stateRows = await db.select().from(alertStates).where(eq(alertStates.productId, productId));

  const evalOffers: EvalOffer[] = offerRows.map((o) => ({
    offerId: o.offerId,
    storeId: o.storeId,
    storeName: o.storeName,
    url: o.url,
    priceCents: o.priceCents,
    shippingCents: o.shippingCents,
    shippingKnown: o.shippingKnown,
    availability: o.availability,
    matchStatus: o.matchStatus,
    lastSuccessAt: o.lastSuccessAt,
    isActive: o.isActive,
  }));

  const history: EvalPoint[] = historyRows.map((h) => ({
    priceCents: (h.shippingKnown && h.totalCents !== null ? h.totalCents : h.priceCents) as number,
    collectedAt: h.collectedAt,
  }));

  const states: EvalState[] = stateRows.map((s) => ({
    type: s.type as AlertType,
    isActive: s.isActive,
    lastAlertPriceCents: s.lastAlertPriceCents,
  }));

  const evalSettings: EvalSettings = {
    intervalHours: settings.intervalHours,
    staleAfterIntervals: settings.staleAfterIntervals,
    dropThresholdPercent: settings.dropThresholdPercent,
    dropWindowDays: settings.dropWindowDays,
    realertDropPercent: settings.realertDropPercent,
    otherStoreThresholdPercent: settings.otherStoreThresholdPercent,
    enabledEvents: settings.alertEvents,
  };

  const decisions = evaluateAlerts({
    product: {
      id: product.id,
      name: product.name,
      targetPriceCents: product.targetPriceCents,
      maxBudgetCents: product.maxBudgetCents,
    },
    offers: evalOffers,
    history,
    now,
    settings: evalSettings,
    states,
  });

  let created = 0;
  await db.transaction(async (tx) => {
    for (const d of decisions) {
      await tx
        .insert(alertStates)
        .values({
          productId,
          type: d.type,
          isActive: d.active,
          lastAlertPriceCents: d.nextLastAlertPriceCents,
          lastEvaluatedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [alertStates.productId, alertStates.type],
          set: {
            isActive: d.active,
            lastAlertPriceCents: d.nextLastAlertPriceCents,
            lastEvaluatedAt: now,
            updatedAt: now,
          },
        });

      if (d.shouldAlert && d.candidate) {
        const c = d.candidate;
        await tx.insert(alerts).values({
          productId,
          offerId: c.offerId,
          storeId: c.storeId,
          runId,
          type: d.type,
          status: "nao_lido",
          title: c.title.slice(0, 240),
          message: c.message,
          observedPriceCents: c.observedPriceCents,
          targetPriceCents: c.targetPriceCents,
          referencePriceCents: c.referencePriceCents,
          offerUrl: c.offerUrl,
          createdAt: now,
          updatedAt: now,
        });
        created++;
      }
    }
  });
  return { created };
}

export async function countUnreadAlerts(db: Db): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(alerts)
    .where(eq(alerts.status, "nao_lido"));
  return rows[0]?.n ?? 0;
}

