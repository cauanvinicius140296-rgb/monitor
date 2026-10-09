"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/db/client";
import { ensureBootstrapped } from "@/db/bootstrap";
import { formDataToObject } from "@/lib/validation/schemas";
import { fail, done, type ActionState } from "@/lib/action-state";
import { parseMoneyToCents } from "@/lib/money";
import { addOffer, DuplicateOfferError, registerManualPrice, setOfferActive, setOfferMatch } from "@/lib/services/offers";
import { searchOffersForProduct } from "@/lib/services/search-offers";
import { identifyFromUrl } from "@/lib/services/identify";
import { parseUserProductUrl, UnsafeUrlError } from "@/lib/security/url";
import { consumeRateLimit } from "@/lib/rate-limit";

const availabilityEnum = z.enum(["disponivel", "indisponivel", "desconhecido"]);

export async function addOfferAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  await ensureBootstrapped();
  const raw = formDataToObject(formData);
  const productId = z.string().uuid().safeParse(raw.productId);
  if (!productId.success) return fail("Produto inválido.");
  const limit = await consumeRateLimit(`offer-add:${user.id}`, 120, 60 * 60);
  if (!limit.allowed) return fail("Muitas ofertas cadastradas nesta hora. Tente mais tarde.");

  let url;
  try {
    url = parseUserProductUrl(raw.url ?? "");
  } catch (err) {
    return fail(err instanceof UnsafeUrlError ? err.message : "URL inválida.", { url: "Use um link https completo." });
  }
  const availability = availabilityEnum.safeParse(raw.availability ?? "desconhecido");
  const priceCents = parseMoneyToCents(raw.priceCents ?? "");
  const shippingRaw = (raw.shippingCents ?? "").trim();
  const shippingCents = shippingRaw === "" ? null : parseMoneyToCents(shippingRaw);
  if (shippingRaw !== "" && shippingCents === null) return fail("Frete inválido.", { shippingCents: "Informe um valor válido." });

  const identify = await identifyFromUrl(url.toString());
  const identified = identify.ok ? identify.identified : null;
  try {
    const result = await addOffer(getDb(), {
      productId: productId.data,
      rawUrl: url.toString(),
      identified,
      manual: {
        priceCents,
        shippingCents,
        shippingKnown: shippingCents !== null,
        availability: availability.success ? availability.data : "desconhecido",
      },
    });
    revalidatePath(`/produtos/${productId.data}`);
    revalidatePath("/produtos");
    revalidatePath("/");
    const extra = result.match.status === "confirmado" ? "" : ` Correspondência: ${result.match.reasons.join("; ")}.`;
    const base = identified ? "Oferta adicionada com dados identificados automaticamente." : "Oferta adicionada.";
    return done(`${base}${extra}${priceCents === null && !identified ? " Registre o preço quando souber." : ""}`);
  } catch (err) {
    if (err instanceof DuplicateOfferError) return fail(err.message, { url: err.message });
    return fail(err instanceof Error ? err.message : "Não foi possível adicionar a oferta.");
  }
}

const manualPriceSchema = z.object({
  offerId: z.string().uuid(),
  productId: z.string().uuid(),
  availability: availabilityEnum,
});

export async function registerManualPriceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const raw = formDataToObject(formData);
  const parsed = manualPriceSchema.safeParse({ offerId: raw.offerId, productId: raw.productId, availability: raw.availability ?? "disponivel" });
  if (!parsed.success) return fail("Dados inválidos.");
  const priceCents = parseMoneyToCents(raw.priceCents ?? "");
  if (priceCents === null) return fail("Informe o preço.", { priceCents: "Ex.: 1.299,90" });
  const shippingRaw = (raw.shippingCents ?? "").trim();
  const shippingCents = shippingRaw === "" ? null : parseMoneyToCents(shippingRaw);
  if (shippingRaw !== "" && shippingCents === null) return fail("Frete inválido.", { shippingCents: "Informe um valor válido." });
  await registerManualPrice(getDb(), {
    offerId: parsed.data.offerId,
    priceCents,
    shippingCents,
    availability: parsed.data.availability,
  });
  revalidatePath(`/produtos/${parsed.data.productId}`);
  revalidatePath("/produtos");
  revalidatePath("/");
  revalidatePath("/alertas");
  return done("Preço registrado no histórico.");
}

const matchSchema = z.object({
  offerId: z.string().uuid(),
  productId: z.string().uuid(),
  status: z.enum(["confirmado", "pendente", "divergente"]),
});

export async function setOfferMatchAction(formData: FormData): Promise<void> {
  await requireUser();
  const raw = formDataToObject(formData);
  const parsed = matchSchema.safeParse(raw);
  if (!parsed.success) return;
  await setOfferMatch(getDb(), parsed.data.offerId, parsed.data.status, parsed.data.status === "confirmado" ? "Confirmado manualmente" : "Revisão manual");
  revalidatePath(`/produtos/${parsed.data.productId}`);
  revalidatePath("/");
}

const activeSchema = z.object({ offerId: z.string().uuid(), productId: z.string().uuid(), active: z.enum(["1", "0"]) });

export async function toggleOfferAction(formData: FormData): Promise<void> {
  await requireUser();
  const parsed = activeSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return;
  await setOfferActive(getDb(), parsed.data.offerId, parsed.data.active === "1");
  revalidatePath(`/produtos/${parsed.data.productId}`);
  revalidatePath("/");
}

const searchSchema = z.object({ productId: z.string().uuid() });

/**
 * Busca ofertas correspondentes ao produto na API oficial do Mercado Livre
 * e devolve os candidatos com a avaliação de correspondência.
 */
export async function searchOffersAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  await ensureBootstrapped();
  const parsed = searchSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return fail("Produto inválido.");
  const limit = await consumeRateLimit(`offer-search:${user.id}`, 60, 60 * 60);
  if (!limit.allowed) return fail("Muitas buscas nesta hora. Tente mais tarde.");
  try {
    const result = await searchOffersForProduct(getDb(), { productId: parsed.data.productId });
    if (result.candidates.length === 0) {
      return done(
        result.query
          ? `A busca oficial do Mercado Livre não retornou anúncios para "${result.query}". Ajuste o nome/marca/modelo do produto ou adicione o link manualmente.`
          : "Cadastre nome (e, se possível, marca/modelo) no produto para habilitar a busca.",
        { query: result.query, candidates: [] },
      );
    }
    return done(`${result.candidates.length} anúncio(s) encontrado(s) no Mercado Livre. Revise antes de adicionar.`, {
      query: result.query,
      candidates: result.candidates,
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : "Não foi possível concluir a busca.");
  }
}
