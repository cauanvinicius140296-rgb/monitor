"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/db/client";
import { products } from "@/db/schema";
import { eq } from "drizzle-orm";
import { formDataToObject, productFormSchema, zodFieldErrors, offerFormSchema } from "@/lib/validation/schemas";
import { fail, done, type ActionState } from "@/lib/action-state";
import { consumeRateLimit } from "@/lib/rate-limit";
import { findProductDuplicates, insertProduct, setProductStatus, updateProductRow } from "@/lib/services/products";
import { identifyFromUrl } from "@/lib/services/identify";
import { addOffer } from "@/lib/services/offers";
import { ensureBootstrapped } from "@/db/bootstrap";
import { parseMoneyToCents } from "@/lib/money";
import { z } from "zod";

function parseProductForm(formData: FormData) {
  const raw = formDataToObject(formData);
  return productFormSchema.safeParse({
    name: raw.name ?? "",
    category: raw.category ?? "Outros",
    subcategory: raw.subcategory ?? "",
    brand: raw.brand ?? "",
    model: raw.model ?? "",
    manufacturerCode: raw.manufacturerCode ?? "",
    gtin: raw.gtin ?? "",
    imageUrl: raw.imageUrl ?? "",
    referenceUrl: raw.referenceUrl ?? "",
    targetPriceCents: raw.targetPriceCents ?? "",
    maxBudgetCents: raw.maxBudgetCents ?? "",
    referencePriceCents: raw.referencePriceCents ?? "",
    notes: raw.notes ?? "",
    priority: raw.priority ?? "media",
    status: raw.status ?? "monitorando",
  });
}

/**
 * Identifica nome, imagem, preço e modelo a partir de uma URL (somente loja com API oficial).
 * Limitado por usuário para evitar abuso. Não impede o cadastro manual.
 */
export async function identifyUrlAction(rawUrl: string): Promise<ActionState> {
  const user = await requireUser();
  const limit = await consumeRateLimit(`identify:${user.id}`, 60, 60 * 60);
  if (!limit.allowed) return fail("Limite de identificações atingido nesta hora. Preencha manualmente ou tente mais tarde.");
  const outcome = await identifyFromUrl(String(rawUrl ?? ""));
  if (!outcome.ok) return fail(outcome.message);
  return done(outcome.message, {
    storeSlug: outcome.storeSlug,
    storeName: outcome.storeName,
    canonicalUrl: outcome.canonicalUrl,
    externalId: outcome.externalId,
    title: outcome.identified?.title ?? null,
    imageUrl: outcome.identified?.imageUrl ?? null,
    priceCents: outcome.identified?.priceCents ?? null,
    shippingCents: outcome.identified?.shippingCents ?? null,
    shippingKnown: outcome.identified?.shippingKnown ?? false,
    availability: outcome.identified?.availability ?? "desconhecido",
    brand: outcome.identified?.brand ?? null,
    model: outcome.identified?.model ?? null,
    gtin: outcome.identified?.gtin ?? null,
    identified: outcome.identified !== null,
  });
}

export async function createProductAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  await ensureBootstrapped();
  const parsed = parseProductForm(formData);
  const offerUrlRaw = String(formData.get("offerUrl") ?? "").trim();
  const offerPriceRaw = String(formData.get("offerPriceCents") ?? "").trim();
  const offerShippingRaw = String(formData.get("offerShippingCents") ?? "").trim();
  const offerAvailability = String(formData.get("offerAvailability") ?? "desconhecido");
  const confirmDuplicate = formData.get("confirmDuplicate") === "1";

  if (!parsed.success) {
    return fail("Revise os campos destacados.", zodFieldErrors(parsed.error));
  }
  const input = parsed.data;
  const db = getDb();

  if (!confirmDuplicate) {
    const dups = await findProductDuplicates(db, input);
    if (dups.length > 0) {
      return fail(
        `Possível duplicata: ${dups.map((d) => `"${d.name}" (${d.reason})`).join("; ")}. Confirme se deseja cadastrar mesmo assim.`,
        { duplicate: "1" },
      );
    }
  }

  // Oferta inicial opcional: a URL é reidentificada no servidor (não confiamos em dados enviados pelo navegador).
  let offerInput: Parameters<typeof addOffer>[1] | null = null;
  if (offerUrlRaw) {
    const identify = await identifyFromUrl(offerUrlRaw).catch(() => null);
    if (identify && !identify.ok) return fail(identify.message, { offerUrl: identify.message });
    offerInput = {
      productId: "",
      rawUrl: offerUrlRaw,
      identified: identify && identify.ok ? identify.identified : null,
      manual: {
        priceCents: parseMoneyToCents(offerPriceRaw),
        shippingCents: parseMoneyToCents(offerShippingRaw),
        shippingKnown: offerShippingRaw !== "",
        availability: (["disponivel", "indisponivel", "desconhecido"].includes(offerAvailability)
          ? offerAvailability
          : "desconhecido") as "disponivel" | "indisponivel" | "desconhecido",
      },
    };
    const check = offerFormSchema.pick({ url: true }).safeParse({ url: offerUrlRaw });
    if (!check.success) return fail("URL da oferta inválida.", { offerUrl: check.error.issues[0]?.message ?? "" });
  }

  const productId = await insertProduct(db, input);
  if (offerInput) {
    try {
      await addOffer(db, { ...offerInput, productId });
    } catch (err) {
      // O produto já foi criado; a falha da oferta é informada sem apagar nada.
      const message = err instanceof Error ? err.message : "Não foi possível adicionar a oferta.";
      revalidatePath("/produtos");
      redirect(`/produtos/${productId}?aviso=${encodeURIComponent(message)}`);
    }
  }
  revalidatePath("/produtos");
  revalidatePath("/");
  redirect(`/produtos/${productId}`);
}

export async function updateProductAction(productId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = parseProductForm(formData);
  if (!parsed.success) return fail("Revise os campos destacados.", zodFieldErrors(parsed.error));
  const db = getDb();
  const [exists] = await db.select({ id: products.id }).from(products).where(eq(products.id, productId)).limit(1);
  if (!exists) return fail("Produto não encontrado.");
  await updateProductRow(db, productId, parsed.data);
  revalidatePath(`/produtos/${productId}`);
  revalidatePath("/produtos");
  revalidatePath("/");
  return done("Produto atualizado.");
}

const statusSchema = z.object({ productId: z.string().uuid(), status: z.enum(["monitorando", "comprado", "pausado", "arquivado"]) });

export async function setProductStatusAction(formData: FormData): Promise<void> {
  await requireUser();
  const parsed = statusSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return;
  await setProductStatus(getDb(), parsed.data.productId, parsed.data.status);
  revalidatePath(`/produtos/${parsed.data.productId}`);
  revalidatePath("/produtos");
  revalidatePath("/");
}
