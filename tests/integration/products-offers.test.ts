import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb, resetData, productInput } from "./helpers";
import { offers, priceHistory, products, stores, purchases } from "@/db/schema";
import { findProductDuplicates, insertProduct, updateProductRow } from "@/lib/services/products";
import { addOffer, DuplicateOfferError, registerManualPrice, setOfferActive } from "@/lib/services/offers";
import { registerPurchase } from "@/lib/services/purchases";
import { loadCatalog } from "@/lib/repos/catalog";
import { loadSettings } from "@/lib/repos/settings-repo";
import { DEFAULT_SETTINGS } from "@/lib/settings-defaults";

const GTIN = "7891234567895";
const NOW = new Date();

beforeEach(async () => {
  await resetData();
});

describe("cadastro e edição de produtos (persistência)", () => {
  it("grava e relê o produto com preços em centavos", async () => {
    const db = getDb();
    const id = await insertProduct(db, productInput({ targetPriceCents: "299,90", maxBudgetCents: "350,00" }));
    const [row] = await db.select().from(products).where(eq(products.id, id));
    expect(row.name).toBe("Air fryer 5L Exemplo");
    expect(row.targetPriceCents).toBe(29_990);
    expect(row.maxBudgetCents).toBe(35_000);
    expect(row.status).toBe("monitorando");
  });

  it("edita os dados e mantém o identificador", async () => {
    const db = getDb();
    const id = await insertProduct(db, productInput());
    await updateProductRow(db, id, productInput({ name: "Air fryer 4L nova", targetPriceCents: "250,00" }));
    const [row] = await db.select().from(products).where(eq(products.id, id));
    expect(row.name).toBe("Air fryer 4L nova");
    expect(row.targetPriceCents).toBe(25_000);
  });

  it("detecta possíveis duplicados pelo GTIN, sem agrupar por nome semelhante", async () => {
    const db = getDb();
    await insertProduct(db, productInput({ gtin: GTIN }));
    const byGtin = await findProductDuplicates(db, { gtin: GTIN, manufacturerCode: null, brand: null, model: null });
    expect(byGtin.length).toBe(1);
    const sameName = await findProductDuplicates(db, { gtin: null, manufacturerCode: null, brand: "Outra", model: "XYZ-1" });
    expect(sameName.length).toBe(0);
  });
});

describe("ofertas e histórico append-only", () => {
  it("cria oferta manual com a primeira observação e bloqueia duplicata na mesma loja", async () => {
    const db = getDb();
    const productId = await insertProduct(db, productInput());
    const url = "https://www.loja-exemplo.com.br/produto/42?utm_source=x";
    const first = await addOffer(db, {
      productId,
      rawUrl: url,
      identified: null,
      manual: { priceCents: 28_900, shippingCents: 0, shippingKnown: true, availability: "disponivel" },
      now: NOW,
    });
    expect(first.offerId).toBeTruthy();
    const hist = await db.select().from(priceHistory).where(eq(priceHistory.offerId, first.offerId));
    expect(hist).toHaveLength(1);
    expect(hist[0].source).toBe("manual");
    expect(hist[0].priceCents).toBe(28_900);

    await expect(
      addOffer(db, {
        productId,
        rawUrl: "https://loja-exemplo.com.br/produto/42",
        identified: null,
        manual: { priceCents: 28_900, shippingCents: null, shippingKnown: false, availability: "desconhecido" },
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(DuplicateOfferError);
  });

  it("registra novos preços sem alterar observações anteriores", async () => {
    const db = getDb();
    const productId = await insertProduct(db, productInput());
    const { offerId } = await addOffer(db, {
      productId,
      rawUrl: "https://loja-exemplo.com.br/item/7",
      identified: null,
      manual: { priceCents: 50_000, shippingCents: 0, shippingKnown: true, availability: "disponivel" },
      now: new Date(NOW.getTime() - 86_400_000),
    });
    const before = await db.select().from(priceHistory).where(eq(priceHistory.offerId, offerId));
    await registerManualPrice(db, { offerId, priceCents: 45_000, shippingCents: 0, availability: "disponivel", now: NOW });
    const after = await db.select().from(priceHistory).where(eq(priceHistory.offerId, offerId));
    expect(after).toHaveLength(before.length + 1);
    const original = after.find((h) => h.id === before[0].id);
    expect(original?.priceCents).toBe(50_000);
  });

  it("consolida: melhor oferta pelo total (preço + frete conhecido) e menor observado do sistema", async () => {
    const db = getDb();
    const productId = await insertProduct(db, productInput({ targetPriceCents: "" }));
    const a = await addOffer(db, {
      productId,
      rawUrl: "https://loja-a.com.br/p/1",
      identified: null,
      manual: { priceCents: 30_000, shippingCents: 0, shippingKnown: true, availability: "disponivel" },
      now: NOW,
    });
    await addOffer(db, {
      productId,
      rawUrl: "https://loja-b.com.br/p/2",
      identified: null,
      manual: { priceCents: 28_000, shippingCents: 4_000, shippingKnown: true, availability: "disponivel" },
      now: NOW,
    });
    const settings = await loadSettings(db);
    const [view] = await loadCatalog(db, { now: NOW, settings, filter: { productIds: [productId] } });
    expect(view.bestComparableCents).toBe(30_000); // 28.000 + 4.000 > 30.000
    expect(view.best?.id).toBe(a.offerId);
    expect(view.offers).toHaveLength(2);
    // Menor observado usa o mesmo valor comparável (preço + frete conhecido): 30.000, não 28.000.
    expect(view.minObservedCents).toBe(30_000);
  });

  it("desativar oferta a retira da comparação ativa", async () => {
    const db = getDb();
    const productId = await insertProduct(db, productInput());
    const { offerId } = await addOffer(db, {
      productId,
      rawUrl: "https://loja-c.com.br/p/3",
      identified: null,
      manual: { priceCents: 20_000, shippingCents: 0, shippingKnown: true, availability: "disponivel" },
      now: NOW,
    });
    await setOfferActive(db, offerId, false);
    const settings = await loadSettings(db);
    const [view] = await loadCatalog(db, { now: NOW, settings, filter: { productIds: [productId] } });
    expect(view.activeOffers).toBe(0);
    expect(view.best).toBeNull();
  });
});

describe("compras e economia realizada", () => {
  it("calcula economia realizada contra a referência e multiplica pela quantidade", async () => {
    const db = getDb();
    const productId = await insertProduct(db, productInput());
    const { offerId } = await addOffer(db, {
      productId,
      rawUrl: "https://loja-d.com.br/p/4",
      identified: null,
      manual: { priceCents: 50_000, shippingCents: 0, shippingKnown: true, availability: "disponivel" },
      now: NOW,
    });
    await registerManualPrice(db, { offerId, priceCents: 45_000, shippingCents: 0, availability: "disponivel", now: NOW });
    const result = await registerPurchase(db, {
      productId,
      offerId,
      storeId: null,
      quantity: 2,
      paidUnitCents: 45_000,
      paidShippingCents: 1_000,
      purchasedAt: NOW,
      notes: null,
    });
    // referência (maior dos últimos 90 dias = 50.000) - pago (45.000) = 5.000 por unidade × 2
    expect(result.realizedSavingCents).toBe(10_000);
    const [row] = await db.select().from(purchases).where(eq(purchases.productId, productId));
    expect(row.referenceUnitCents).toBe(50_000);
    const [p] = await db.select().from(products).where(eq(products.id, productId));
    expect(p.status).toBe("comprado");
  });
});

describe("lojas e ofertas de demonstração", () => {
  it("a loja de demonstração é marcada como manual e não automática", async () => {
    const db = getDb();
    const [outra] = await db.select().from(stores).where(eq(stores.slug, "outra-loja"));
    expect(outra.automated).toBe(false);
    expect(outra.integrationMode).toBe("manual");
    const [ml] = await db.select().from(stores).where(eq(stores.slug, "mercado-livre"));
    expect(ml.automated).toBe(true);
    expect(ml.integrationMode).toBe("api");
  });

  it("configurações padrão do projeto", async () => {
    const db = getDb();
    const settings = await loadSettings(db);
    expect(settings.intervalHours).toBe(DEFAULT_SETTINGS.intervalHours);
    expect(settings.batchSize).toBe(20);
    expect(settings.maxPerStorePerRun).toBe(10);
    const offerCount = await db.select().from(offers).where(and(eq(offers.source, "demo")));
    expect(offerCount).toHaveLength(0);
  });
});
