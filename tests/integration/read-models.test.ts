import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetData, productInput } from "./helpers";
import { insertProduct } from "@/lib/services/products";
import { addOffer, registerManualPrice } from "@/lib/services/offers";
import { loadCatalog } from "@/lib/repos/catalog";
import { loadDashboard } from "@/lib/repos/dashboard";
import { loadSettings } from "@/lib/repos/settings-repo";

const NOW = new Date();
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

beforeEach(async () => {
  await resetData();
});

async function seed() {
  const db = getDb();
  const p1 = await insertProduct(db, productInput({ name: "Air fryer Alfa", targetPriceCents: "400,00" }));
  const p2 = await insertProduct(db, productInput({ name: "Ferro Beta", priority: "baixa", status: "pausado" }));
  const p3 = await insertProduct(db, productInput({ name: "Arquivado Gama", status: "arquivado" }));
  const o1 = await addOffer(db, {
    productId: p1,
    rawUrl: "https://loja-x.com.br/p/1",
    identified: null,
    manual: { priceCents: 50_000, shippingCents: 0, shippingKnown: true, availability: "disponivel" },
    now: daysAgo(20),
  });
  await registerManualPrice(db, { offerId: o1.offerId, priceCents: 38_000, shippingCents: 0, availability: "disponivel", now: daysAgo(2) });
  await addOffer(db, {
    productId: p2,
    rawUrl: "https://loja-y.com.br/p/2",
    identified: null,
    manual: { priceCents: 9_900, shippingCents: null, shippingKnown: false, availability: "desconhecido" },
    now: NOW,
  });
  await addOffer(db, {
    productId: p3,
    rawUrl: "https://loja-z.com.br/p/3",
    identified: null,
    manual: { priceCents: 1_000, shippingCents: 0, shippingKnown: true, availability: "disponivel" },
    now: NOW,
  });
  return { p1, p2, p3 };
}

describe("leitura consolidada (painel, lista de produtos)", () => {
  it("catálogo sem filtro exclui arquivados e calcula queda e menor observado", async () => {
    const { p1, p2, p3 } = await seed();
    const db = getDb();
    const settings = await loadSettings(db);
    const views = await loadCatalog(db, { now: NOW, settings });
    const ids = views.map((v) => v.id);
    expect(ids).toContain(p1);
    expect(ids).toContain(p2);
    expect(ids).not.toContain(p3);

    const alfa = views.find((v) => v.id === p1)!;
    expect(alfa.bestComparableCents).toBe(38_000);
    expect(alfa.minObservedCents).toBe(38_000);
    expect(alfa.maxObservedCents).toBe(50_000);
    expect(alfa.validHistoryCount).toBe(2);
    expect(alfa.targetReached).toBe(true);
    expect(alfa.savingCents).toBeGreaterThanOrEqual(0);

    const beta = views.find((v) => v.id === p2)!;
    expect(beta.offers[0].shippingKnown).toBe(false);
    expect(beta.bestComparableCents).toBe(9_900); // frete desconhecido: usa o preço
  });

  it("filtro por status inclui arquivados quando pedido", async () => {
    const { p3 } = await seed();
    const db = getDb();
    const settings = await loadSettings(db);
    const views = await loadCatalog(db, { now: NOW, settings, filter: { statuses: ["arquivado"] } });
    expect(views.map((v) => v.id)).toEqual([p3]);
  });

  it("ordena as ofertas do produto por preço total (comparável), sem preço por último", async () => {
    const db = getDb();
    const p = await insertProduct(db, productInput({ name: "Liquidificador Ordenação" }));
    await addOffer(db, {
      productId: p,
      rawUrl: "https://loja-x.com.br/p/cara",
      identified: null,
      manual: { priceCents: 40_000, shippingCents: 5_000, shippingKnown: true, availability: "disponivel" },
      now: NOW,
    });
    await addOffer(db, {
      productId: p,
      rawUrl: "https://loja-y.com.br/p/barata",
      identified: null,
      manual: { priceCents: 30_000, shippingCents: 0, shippingKnown: true, availability: "disponivel" },
      now: NOW,
    });
    await addOffer(db, {
      productId: p,
      rawUrl: "https://loja-z.com.br/p/sem-preco",
      identified: null,
      manual: { priceCents: null, shippingCents: null, shippingKnown: false, availability: "desconhecido" },
      now: NOW,
    });
    const settings = await loadSettings(db);
    const [view] = await loadCatalog(db, { now: NOW, settings, filter: { productIds: [p] } });
    // 30.000 (frete grátis) < 45.000 (40.000 + 5.000) < sem preço.
    expect(view.offers.map((o) => o.comparableCents)).toEqual([30_000, 45_000, null]);
    expect(view.best?.comparableCents).toBe(30_000);
  });

  it("painel carrega indicadores sem erro", async () => {
    await seed();
    const db = getDb();
    const settings = await loadSettings(db);
    const data = await loadDashboard(db, NOW, settings);
    expect(data).toBeDefined();
    expect(JSON.stringify(data)).toContain("Alfa");
  });
});
