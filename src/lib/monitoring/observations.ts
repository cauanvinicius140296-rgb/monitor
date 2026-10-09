import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { offers, priceHistory, stores } from "@/db/schema";
import type { OfferSnapshot, SourceError } from "../adapters/types";

export interface OfferTarget {
  id: string;
  productId: string;
  storeId: string;
}

/** Preço comparável de uma observação: preço + frete quando o frete é conhecido. */
export function comparableCents(priceCents: number | null, shippingCents: number | null, shippingKnown: boolean): number | null {
  if (priceCents === null) return null;
  return shippingKnown && shippingCents !== null ? priceCents + shippingCents : priceCents;
}

/**
 * Grava uma observação válida no histórico (append-only) e atualiza o estado atual da oferta.
 * Idempotente por (oferta, execução): repetir a mesma coleta não duplica o registro.
 */
export async function recordSuccess(
  db: Db,
  args: { runId: string | null; offer: OfferTarget; snapshot: OfferSnapshot; now: Date; manual?: boolean },
): Promise<{ inserted: boolean }> {
  const { runId, offer, snapshot, now } = args;
  const total = comparableCents(snapshot.priceCents, snapshot.shippingCents, snapshot.shippingKnown);
  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(priceHistory)
      .values({
        offerId: offer.id,
        productId: offer.productId,
        storeId: offer.storeId,
        runId,
        status: "sucesso",
        priceCents: snapshot.priceCents,
        shippingCents: snapshot.shippingCents,
        shippingKnown: snapshot.shippingKnown,
        totalCents: total,
        availability: snapshot.availability,
        source: snapshot.source,
        collectedAt: now,
      })
      .onConflictDoNothing({
        target: [priceHistory.offerId, priceHistory.runId],
        where: sql`${priceHistory.runId} is not null`,
      })
      .returning({ id: priceHistory.id });

    const patch: Partial<typeof offers.$inferInsert> = {
      currentPriceCents: snapshot.priceCents,
      currentShippingCents: snapshot.shippingCents,
      shippingKnown: snapshot.shippingKnown,
      currentAvailability: snapshot.availability,
      lastCheckedAt: now,
      lastSuccessAt: now,
      lastError: null,
      lastErrorAt: null,
      consecutiveFailures: 0,
      updatedAt: now,
    };
    if (snapshot.title) patch.title = snapshot.title.slice(0, 300);
    if (snapshot.imageUrl) patch.imageUrl = snapshot.imageUrl;
    if (snapshot.sellerName) patch.sellerName = snapshot.sellerName.slice(0, 160);
    await tx.update(offers).set(patch).where(eq(offers.id, offer.id));
    return { inserted: inserted.length > 0 };
  });
}

/**
 * Registra uma falha de coleta (fica no histórico para diagnóstico, sem preço).
 * Anúncio não encontrado marca a oferta como indisponível.
 */
export async function recordFailure(
  db: Db,
  args: { runId: string | null; offer: OfferTarget; error: SourceError; source: string; now: Date },
): Promise<void> {
  const { runId, offer, error, now } = args;
  const notFound = error.code === "not_found";
  await db.transaction(async (tx) => {
    await tx
      .insert(priceHistory)
      .values({
        offerId: offer.id,
        productId: offer.productId,
        storeId: offer.storeId,
        runId,
        status: "erro",
        priceCents: null,
        shippingCents: null,
        shippingKnown: false,
        totalCents: null,
        availability: notFound ? "indisponivel" : "desconhecido",
        source: args.source,
        errorCode: error.code,
        errorMessage: error.message.slice(0, 500),
        collectedAt: now,
      })
      .onConflictDoNothing({
        target: [priceHistory.offerId, priceHistory.runId],
        where: sql`${priceHistory.runId} is not null`,
      });
    await tx
      .update(offers)
      .set({
        lastCheckedAt: now,
        lastErrorAt: now,
        lastError: error.message.slice(0, 500),
        consecutiveFailures: sql`${offers.consecutiveFailures} + 1`,
        ...(notFound ? { currentAvailability: "indisponivel" as const } : {}),
        updatedAt: now,
      })
      .where(eq(offers.id, offer.id));
  });
}

/** Atualiza a saúde da loja. Só falhas da fonte (não de um anúncio específico) contam. */
export async function updateStoreHealth(
  db: Db,
  args: { storeId: string; ok: boolean; sourceLevelError: boolean; message?: string; now: Date },
): Promise<void> {
  if (args.ok) {
    await db
      .update(stores)
      .set({ consecutiveFailures: 0, lastSuccessAt: args.now, lastError: null, updatedAt: args.now })
      .where(eq(stores.id, args.storeId));
    return;
  }
  if (!args.sourceLevelError) return;
  await db
    .update(stores)
    .set({
      consecutiveFailures: sql`${stores.consecutiveFailures} + 1`,
      lastFailureAt: args.now,
      lastError: (args.message ?? "Falha na fonte").slice(0, 500),
      updatedAt: args.now,
    })
    .where(eq(stores.id, args.storeId));
}
