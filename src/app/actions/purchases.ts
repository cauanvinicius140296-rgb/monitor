"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/db/client";
import { formDataToObject } from "@/lib/validation/schemas";
import { fail, done, type ActionState } from "@/lib/action-state";
import { parseMoneyToCents, formatBRL } from "@/lib/money";
import { registerPurchase } from "@/lib/services/purchases";
import { offers } from "@/db/schema";
import { eq } from "drizzle-orm";

const schema = z.object({
  productId: z.string().uuid(),
  offerId: z.string().uuid().or(z.literal("")).transform((v) => (v === "" ? null : v)),
  quantity: z.coerce.number().int().min(1, "Quantidade mínima: 1").max(999),
  purchasedAt: z.string().optional(),
  notes: z.string().trim().max(1000).optional(),
});

export async function registerPurchaseAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const raw = formDataToObject(formData);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return fail("Revise os dados da compra.", { quantity: parsed.error.issues[0]?.message ?? "" });
  const paidUnit = parseMoneyToCents(raw.paidUnitCents ?? "");
  if (paidUnit === null) return fail("Informe o valor pago por unidade.", { paidUnitCents: "Ex.: 1.299,90" });
  const shippingRaw = (raw.paidShippingCents ?? "").trim();
  const paidShipping = shippingRaw === "" ? 0 : parseMoneyToCents(shippingRaw);
  if (paidShipping === null) return fail("Frete pago inválido.", { paidShippingCents: "Informe um valor válido." });

  const db = getDb();
  let storeId: string | null = null;
  if (parsed.data.offerId) {
    const [o] = await db.select({ storeId: offers.storeId, productId: offers.productId }).from(offers).where(eq(offers.id, parsed.data.offerId)).limit(1);
    if (!o || o.productId !== parsed.data.productId) return fail("Oferta não pertence a este produto.");
    storeId = o.storeId;
  }
  const purchasedAt = parsed.data.purchasedAt ? new Date(`${parsed.data.purchasedAt}T12:00:00-03:00`) : new Date();
  const { realizedSavingCents } = await registerPurchase(db, {
    productId: parsed.data.productId,
    offerId: parsed.data.offerId,
    storeId,
    quantity: parsed.data.quantity,
    paidUnitCents: paidUnit,
    paidShippingCents: paidShipping,
    purchasedAt,
    notes: parsed.data.notes || null,
  });
  revalidatePath(`/produtos/${parsed.data.productId}`);
  revalidatePath("/produtos");
  revalidatePath("/lista");
  revalidatePath("/");
  const saving =
    realizedSavingCents === null
      ? "Sem preço de referência para calcular a economia realizada."
      : `Economia realizada em relação à referência: ${formatBRL(realizedSavingCents)}.`;
  return done(`Compra registrada. ${saving}`);
}
