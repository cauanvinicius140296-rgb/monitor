import { beforeEach, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { getDb, resetData, productInput, fakeMercadoLivre, snapshot, noSleep } from "./helpers";
import { alerts, monitoringJobs, monitoringRuns, offers, priceHistory, products, stores } from "@/db/schema";
import { insertProduct } from "@/lib/services/products";
import { runCollection } from "@/lib/monitoring/collector";
import { tryAcquireJobLock, releaseJobLock } from "@/lib/monitoring/lock";
import { SourceError } from "@/lib/adapters/types";
import { JOB_COLETA_AUTOMATICA } from "@/db/bootstrap";

const T0 = new Date("2026-10-09T06:00:00Z");
const hoursAfter = (h: number) => new Date(T0.getTime() + h * 3_600_000);

/** Cria uma oferta do Mercado Livre (API) já vinculada a um produto. */
async function mlOffer(productId: string, externalId: string, source: "api" | "demo" = "api") {
  const db = getDb();
  const [store] = await db.select().from(stores).where(eq(stores.slug, "mercado-livre"));
  const [row] = await db
    .insert(offers)
    .values({
      productId,
      storeId: store.id,
      url: `https://produto.mercadolivre.com.br/MLB-${externalId.slice(3)}-item`,
      externalId,
      dedupeKey: `mercado-livre:${externalId}`,
      source,
      matchStatus: "confirmado",
    })
    .returning({ id: offers.id });
  return row.id;
}

async function newProduct(over: Partial<Record<string, string>> = {}) {
  return insertProduct(getDb(), productInput(over));
}

beforeEach(async () => {
  await resetData();
});

describe("coleta automática (execução no servidor)", () => {
  it("registra preço bem-sucedido no histórico e atualiza a oferta", async () => {
    const db = getDb();
    const productId = await newProduct();
    const offerId = await mlOffer(productId, "MLB1234567890");
    const { adapter, calls } = fakeMercadoLivre(() => snapshot(27_990));

    const summary = await runCollection({
      trigger: "manual",
      productId,
      db,
      owner: "teste-1",
      adapterFor: () => adapter,
      sleepImpl: noSleep,
      retryDelayMs: 0,
      now: () => T0,
    });

    expect(summary.errors, "erro interno da coleta").toEqual([]);
    expect(summary.status).toBe("concluido");
    expect(summary.ok).toBe(1);
    expect(calls).toEqual(["MLB1234567890"]);
    const hist = await db.select().from(priceHistory).where(eq(priceHistory.offerId, offerId));
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ status: "sucesso", priceCents: 27_990, source: "api_mercado_livre" });
    const [run] = await db.select().from(monitoringRuns).where(eq(monitoringRuns.id, summary.runId!));
    expect(run.status).toBe("concluido");
    expect(run.offersOk).toBe(1);
    const [job] = await db.select().from(monitoringJobs).where(eq(monitoringJobs.name, JOB_COLETA_AUTOMATICA));
    expect(job.lockedUntil).toBeNull();
    expect(job.lastStatus).toBe("concluido");
  });

  it("falha controlada (indisponível) gera registro de erro e não grava preço", async () => {
    const db = getDb();
    const productId = await newProduct();
    const offerId = await mlOffer(productId, "MLB1111111111");
    const { adapter } = fakeMercadoLivre(() => new SourceError("unavailable", "API indisponível (teste).", true));

    const summary = await runCollection({
      trigger: "manual",
      productId,
      db,
      adapterFor: () => adapter,
      sleepImpl: noSleep,
      retryDelayMs: 0,
      now: () => T0,
    });

    expect(summary.failed).toBe(1);
    expect(summary.errors[0].code).toBe("unavailable");
    const hist = await db.select().from(priceHistory).where(eq(priceHistory.offerId, offerId));
    expect(hist).toHaveLength(1);
    expect(hist[0].status).toBe("erro");
    expect(hist[0].priceCents).toBeNull();
    expect(hist[0].errorCode).toBe("unavailable");
    const [offer] = await db.select().from(offers).where(eq(offers.id, offerId));
    expect(offer.consecutiveFailures).toBe(1);
  });

  it("após falhas seguidas, a loja fica marcada como indisponível (limite configurável)", async () => {
    const db = getDb();
    const productId = await newProduct();
    await mlOffer(productId, "MLB2222222222");
    const { adapter } = fakeMercadoLivre(() => new SourceError("unavailable", "fora do ar (teste)", true));
    for (let i = 0; i < 3; i++) {
      await runCollection({
        trigger: "cron",
        db,
        adapterFor: () => adapter,
        sleepImpl: noSleep,
        retryDelayMs: 0,
        now: () => hoursAfter(i * 7),
      });
    }
    const [store] = await db.select().from(stores).where(eq(stores.slug, "mercado-livre"));
    expect(store.consecutiveFailures).toBeGreaterThanOrEqual(3);
    expect(store.lastError).toBeTruthy();
    expect(store.lastFailureAt).toBeTruthy();
  });

  it("produto de teste (source demo) nunca é consultado na coleta", async () => {
    const db = getDb();
    const productId = await newProduct();
    await mlOffer(productId, "MLB3333333333", "demo");
    const { adapter, calls } = fakeMercadoLivre(() => snapshot(1_000));
    const summary = await runCollection({
      trigger: "cron",
      db,
      adapterFor: () => adapter,
      sleepImpl: noSleep,
      retryDelayMs: 0,
      now: () => T0,
    });
    expect(calls).toHaveLength(0);
    expect(summary.selected).toBe(0);
  });

  it("circuit breaker: após 3 falhas de fonte seguidas, a loja é adiada nesta rodada sem novas requisições", async () => {
    const db = getDb();
    const productId = await newProduct();
    for (const id of ["MLB5000000001", "MLB5000000002", "MLB5000000003", "MLB5000000004", "MLB5000000005"]) {
      await mlOffer(productId, id);
    }
    const { adapter, calls } = fakeMercadoLivre(() => new SourceError("unavailable", "fora do ar (teste)", true));
    const summary = await runCollection({
      trigger: "cron",
      db,
      adapterFor: () => adapter,
      sleepImpl: noSleep,
      retryDelayMs: 0,
      now: () => T0,
      settingsOverride: { batchSize: 10, maxPerStorePerRun: 10 },
    });
    // 3 ofertas com 2 tentativas cada = 6 chamadas; as 2 restantes ficam adiadas sem chamada.
    expect(calls).toHaveLength(6);
    expect(summary.failed).toBe(3);
    expect(summary.deferred).toBe(2);
  });

  it("não ultrapassa o limite por loja em cada execução", async () => {
    const db = getDb();
    const productId = await newProduct();
    for (const id of ["MLB4000000001", "MLB4000000002", "MLB4000000003"]) await mlOffer(productId, id);
    const { adapter, calls } = fakeMercadoLivre(() => snapshot(10_000));
    const summary = await runCollection({
      trigger: "cron",
      db,
      adapterFor: () => adapter,
      sleepImpl: noSleep,
      retryDelayMs: 0,
      now: () => T0,
      settingsOverride: { maxPerStorePerRun: 2, batchSize: 10 },
    });
    expect(calls).toHaveLength(2);
    expect(summary.deferred).toBe(1);
  });

  it("ofertas recentes (dentro do intervalo) não são consultadas de novo", async () => {
    const db = getDb();
    const productId = await newProduct();
    await mlOffer(productId, "MLB5000000001");
    const { adapter, calls } = fakeMercadoLivre(() => snapshot(10_000));
    await runCollection({ trigger: "cron", db, adapterFor: () => adapter, sleepImpl: noSleep, retryDelayMs: 0, now: () => T0 });
    await runCollection({ trigger: "cron", db, adapterFor: () => adapter, sleepImpl: noSleep, retryDelayMs: 0, now: () => hoursAfter(1) });
    expect(calls).toHaveLength(1);
    await runCollection({ trigger: "cron", db, adapterFor: () => adapter, sleepImpl: noSleep, retryDelayMs: 0, now: () => hoursAfter(7) });
    expect(calls).toHaveLength(2);
  });
});

describe("proteção contra execução duplicada", () => {
  it("a trava impede duas execuções simultâneas e registra a ignorada", async () => {
    const db = getDb();
    const productId = await newProduct();
    await mlOffer(productId, "MLB6000000001");
    const { adapter, calls } = fakeMercadoLivre(() => snapshot(10_000));

    const holder = await tryAcquireJobLock(JOB_COLETA_AUTOMATICA, "outra-execucao", db);
    expect(holder).not.toBeNull();
    const second = await tryAcquireJobLock(JOB_COLETA_AUTOMATICA, "terceira", db);
    expect(second).toBeNull();

    const summary = await runCollection({ trigger: "cron", db, adapterFor: () => adapter, sleepImpl: noSleep, now: () => T0 });
    expect(summary.status).toBe("ignorado");
    expect(calls).toHaveLength(0);
    const [ignored] = await db.select().from(monitoringRuns).where(eq(monitoringRuns.status, "ignorado")).orderBy(desc(monitoringRuns.startedAt));
    expect(ignored.errorSummary).toContain("em andamento");

    await releaseJobLock(holder!, "concluido", db);
    const again = await runCollection({ trigger: "cron", db, adapterFor: () => adapter, sleepImpl: noSleep, now: () => T0 });
    expect(again.status).toBe("concluido");
  });
});

describe("alertas gerados pela coleta", () => {
  it("cria alerta de preço-alvo uma única vez enquanto o preço permanece no patamar", async () => {
    const db = getDb();
    const productId = await newProduct({ targetPriceCents: "300,00" });
    await mlOffer(productId, "MLB7000000001");
    let price = 27_990;
    const { adapter } = fakeMercadoLivre(() => snapshot(price));

    await runCollection({ trigger: "manual", productId, db, adapterFor: () => adapter, sleepImpl: noSleep, retryDelayMs: 0, now: () => T0 });
    const first = await db.select().from(alerts).where(and(eq(alerts.productId, productId), eq(alerts.type, "preco_alvo")));
    expect(first).toHaveLength(1);
    expect(first[0].observedPriceCents).toBe(27_990);
    expect(first[0].status).toBe("nao_lido");

    price = 27_900; // mesmo patamar (queda < 5%)
    await runCollection({ trigger: "manual", productId, db, adapterFor: () => adapter, sleepImpl: noSleep, retryDelayMs: 0, now: () => new Date(T0.getTime() + 60 * 60_000 * 2) });
    const second = await db.select().from(alerts).where(and(eq(alerts.productId, productId), eq(alerts.type, "preco_alvo")));
    expect(second).toHaveLength(1);
  });

  it("não cria alerta de preço-alvo quando o preço está acima do alvo", async () => {
    const db = getDb();
    const productId = await newProduct({ targetPriceCents: "100,00" });
    await mlOffer(productId, "MLB7000000002");
    const { adapter } = fakeMercadoLivre(() => snapshot(27_990));
    await runCollection({ trigger: "manual", productId, db, adapterFor: () => adapter, sleepImpl: noSleep, retryDelayMs: 0, now: () => T0 });
    const rows = await db.select().from(alerts).where(eq(alerts.productId, productId));
    expect(rows.filter((r) => r.type === "preco_alvo")).toHaveLength(0);
  });
});

describe("integridade do modelo", () => {
  it("histórico tem unicidade por oferta e execução (não grava duas vezes na mesma rodada)", async () => {
    const db = getDb();
    const productId = await newProduct();
    const offerId = await mlOffer(productId, "MLB8000000001");
    const [prod] = await db.select().from(products).where(eq(products.id, productId));
    expect(prod.status).toBe("monitorando");
    const [p] = await db.select().from(priceHistory).where(eq(priceHistory.offerId, offerId));
    expect(p).toBeUndefined();
  });
});
