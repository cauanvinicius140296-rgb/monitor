import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { priceHistory, products, purchases } from "@/db/schema";
import { pickReferenceCents, type ReferenceMode } from "../analysis/references";
import { loadSettings } from "../repos/settings-repo";

export interface PurchaseInput {
  productId: string;
  offerId: string | null;
  storeId: string | null;
  quantity: number;
  paidUnitCents: number;
  paidShippingCents: number;
  purchasedAt: Date;
  notes: string | null;
}

/**
 * Registra uma compra. A economia REALIZADA é calculada contra a referência escolhida
 * nas configurações (não confundir com a economia potencial de preços ainda não pagos).
 */
export async function registerPurchase(db: Db, input: PurchaseInput): Promise<{ realizedSavingCents: number | null }> {
  const settings = await loadSettings(db);
  const [product] = await db
    .select({ id: products.id, referencePriceCents: products.referencePriceCents })
    .from(products)
    .where(eq(products.id, input.productId))
    .limit(1);
  if (!product) throw new Error("Produto não encontrado.");

  const history = await db
    .select({ priceCents: priceHistory.priceCents, collectedAt: priceHistory.collectedAt })
    .from(priceHistory)
    .where(eq(priceHistory.productId, input.productId));
  const points = history
    .filter((h) => h.priceCents !== null)
    .map((h) => ({ priceCents: h.priceCents as number, collectedAt: h.collectedAt }));

  const referenceUnit = pickReferenceCents(settings.referenceMode as ReferenceMode, {
    manualReferenceCents: product.referencePriceCents,
    points,
    now: input.purchasedAt,
  });
  const saving = referenceUnit === null ? null : (referenceUnit - input.paidUnitCents) * input.quantity;

  await db.insert(purchases).values({
    productId: input.productId,
    offerId: input.offerId,
    storeId: input.storeId,
    quantity: input.quantity,
    paidUnitCents: input.paidUnitCents,
    paidShippingCents: input.paidShippingCents,
    referenceUnitCents: referenceUnit,
    referenceKind: settings.referenceMode,
    realizedSavingCents: saving,
    purchasedAt: input.purchasedAt,
    notes: input.notes,
  });
  await db.update(products).set({ status: "comprado", updatedAt: new Date() }).where(eq(products.id, input.productId));
  return { realizedSavingCents: saving };
}

