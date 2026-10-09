import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { monitoringRuns, offers, products, stores } from "@/db/schema";
import { getAdapterForStoreSlug, identifyStoreFromUrl } from "../adapters/registry";
import type { IdentifyResult } from "../adapters/types";
import { matchListing, type MatchResult } from "../analysis/matching";
import { canonicalizeUrl, parseUserProductUrl } from "../security/url";
import { recordSuccess } from "../monitoring/observations";
import { evaluateProductAlerts } from "../monitoring/alerts-service";
import { loadSettings } from "../repos/settings-repo";

export class DuplicateOfferError extends Error {
  constructor() {
    super("Esta oferta (mesma loja e mesmo anúncio) já está cadastrada para este produto.");
    this.name = "DuplicateOfferError";
  }
}

export interface AddOfferInput {
  productId: string;
  rawUrl: string;
  identified: IdentifyResult | null;
  manual?: {
    priceCents: number | null;
    shippingCents: number | null;
    shippingKnown: boolean;
    availability: "disponivel" | "indisponivel" | "desconhecido";
  };
  now?: Date;
}

/** Cria uma oferta a partir de URL (com ou sem dados identificados) e registra a primeira observação. */
export async function addOffer(db: Db, input: AddOfferInput): Promise<{ offerId: string; match: MatchResult; alerts: number }> {
  const now = input.now ?? new Date();
  const url = parseUserProductUrl(input.rawUrl);
  const { storeSlug, adapter } = identifyStoreFromUrl(url);
  const ref = adapter?.parseUrl(url) ?? null;
  const externalId = input.identified?.externalId ?? ref?.externalId ?? null;
  const canonical = canonicalizeUrl(url);
  const dedupeKey = `${storeSlug}:${externalId ?? canonical}`.slice(0, 400);

  const [store] = await db.select().from(stores).where(eq(stores.slug, storeSlug)).limit(1);
  if (!store) throw new Error("Loja não cadastrada. Reinicie a aplicação para carregar o catálogo de lojas.");

  const [product] = await db.select().from(products).where(eq(products.id, input.productId)).limit(1);
  if (!product) throw new Error("Produto não encontrado.");

  const existing = await db
    .select({ id: offers.id })
    .from(offers)
    .where(and(eq(offers.productId, input.productId), eq(offers.dedupeKey, dedupeKey)))
    .limit(1);
  if (existing.length) throw new DuplicateOfferError();

  const match = matchListing(
    { name: product.name, brand: product.brand, model: product.model, manufacturerCode: product.manufacturerCode, gtin: product.gtin },
    {
      title: input.identified?.title ?? null,
      brand: input.identified?.brand ?? null,
      model: input.identified?.model ?? null,
      manufacturerCode: input.identified?.manufacturerCode ?? null,
      gtin: input.identified?.gtin ?? null,
    },
  );

  const source = input.identified ? "api" : "manual";
  const [created] = await db
    .insert(offers)
    .values({
      productId: input.productId,
      storeId: store.id,
      url: canonical,
      externalId,
      dedupeKey,
      title: input.identified?.title?.slice(0, 300) ?? null,
      imageUrl: input.identified?.imageUrl ?? null,
      sellerName: input.identified?.sellerName ?? null,
      source,
      matchStatus: match.status,
      matchNotes: match.reasons.join("; "),
      currentAvailability: "desconhecido",
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: offers.id });

  // Preenche dados do produto que estiverem vazios (nunca sobrescreve o que o usuário digitou).
  if (input.identified) {
    const fill: Partial<typeof products.$inferInsert> = {};
    if (!product.brand && input.identified.brand) fill.brand = input.identified.brand;
    if (!product.model && input.identified.model) fill.model = input.identified.model;
    if (!product.gtin && input.identified.gtin && match.status !== "divergente") fill.gtin = input.identified.gtin;
    if (!product.imageUrl && input.identified.imageUrl) fill.imageUrl = input.identified.imageUrl;
    if (Object.keys(fill).length) await db.update(products).set({ ...fill, updatedAt: now }).where(eq(products.id, product.id));
  }

  let alerts = 0;
  const observation = input.identified
    ? {
        priceCents: input.identified.priceCents,
        shippingCents: input.identified.shippingCents,
        shippingKnown: input.identified.shippingKnown,
        availability: input.identified.availability,
        source: "api_mercado_livre",
      }
    : input.manual
      ? { ...input.manual, source: "manual" }
      : null;

  if (observation && observation.priceCents !== null) {
    const run = await createManualRun(db, input.productId, now);
    await recordSuccess(db, {
      runId: run,
      offer: { id: created.id, productId: input.productId, storeId: store.id },
      snapshot: {
        priceCents: observation.priceCents,
        shippingCents: observation.shippingCents,
        shippingKnown: observation.shippingKnown,
        availability: observation.availability,
        source: observation.source,
      },
      now,
      manual: true,
    });
    await finishManualRun(db, run, now);
    const settings = await loadSettings(db);
    alerts = (await evaluateProductAlerts(db, { productId: input.productId, runId: run, now, settings })).created;
  }
  return { offerId: created.id, match, alerts };
}

export async function createManualRun(db: Db, productId: string, now: Date): Promise<string> {
  const [run] = await db
    .insert(monitoringRuns)
    .values({ trigger: "manual", productId, status: "executando", startedAt: now })
    .returning({ id: monitoringRuns.id });
  return run.id;
}

export async function finishManualRun(db: Db, runId: string, now: Date, ok = 1): Promise<void> {
  await db
    .update(monitoringRuns)
    .set({ status: "concluido", finishedAt: now, offersSelected: 1, offersOk: ok, offersFailed: 0 })
    .where(eq(monitoringRuns.id, runId));
}

export interface ManualPriceInput {
  offerId: string;
  priceCents: number;
  shippingCents: number | null;
  availability: "disponivel" | "indisponivel" | "desconhecido";
  now?: Date;
}

/** Registro manual de preço (ex.: loja sem integração). Entra no histórico como fonte "manual". */
export async function registerManualPrice(db: Db, input: ManualPriceInput): Promise<{ alerts: number }> {
  const now = input.now ?? new Date();
  const [row] = await db
    .select({ offerId: offers.id, productId: offers.productId, storeId: offers.storeId })
    .from(offers)
    .where(eq(offers.id, input.offerId))
    .limit(1);
  if (!row) throw new Error("Oferta não encontrada.");
  const run = await createManualRun(db, row.productId, now);
  await recordSuccess(db, {
    runId: run,
    offer: { id: row.offerId, productId: row.productId, storeId: row.storeId },
    snapshot: {
      priceCents: input.priceCents,
      shippingCents: input.shippingCents,
      shippingKnown: input.shippingCents !== null,
      availability: input.availability,
      source: "manual",
    },
    now,
    manual: true,
  });
  await finishManualRun(db, run, now);
  const settings = await loadSettings(db);
  const { created } = await evaluateProductAlerts(db, { productId: row.productId, runId: run, now, settings });
  return { alerts: created };
}

export async function setOfferMatch(db: Db, offerId: string, status: "confirmado" | "pendente" | "divergente", notes: string | null): Promise<void> {
  await db
    .update(offers)
    .set({ matchStatus: status, matchNotes: notes, updatedAt: new Date() })
    .where(eq(offers.id, offerId));
}

export async function setOfferActive(db: Db, offerId: string, active: boolean): Promise<void> {
  await db.update(offers).set({ isActive: active, updatedAt: new Date() }).where(eq(offers.id, offerId));
}

