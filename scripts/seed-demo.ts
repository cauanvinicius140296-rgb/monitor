/**
 * DADOS DE DEMONSTRAÇÃO — somente para desenvolvimento e testes.
 *
 * Cria um produto e ofertas marcados como "[DEMO]" (source = 'demo'), com histórico simulado.
 * Essas ofertas são excluídas da coleta automática e nunca devem ser usadas como preço real.
 *
 * Uso (exige confirmação explícita):
 *   RADAR_DEMO_SEED=1 DATABASE_URL=... npm run seed:demo
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, like } from "drizzle-orm";
import * as schema from "../src/db/schema";
import { offers, priceHistory, products, stores } from "../src/db/schema";
import { isLocalDatabaseUrl } from "../src/lib/db-url";
import { ensureBaseData } from "../src/db/bootstrap";

const DEMO_NAME = "[DEMO] Air fryer de teste (dados simulados)";

async function main() {
  if (process.env.RADAR_DEMO_SEED !== "1") {
    throw new Error("Defina RADAR_DEMO_SEED=1 para confirmar a criação de dados de demonstração.");
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida.");
  const client = postgres(url, { max: 1, prepare: false, ssl: isLocalDatabaseUrl(url) ? false : "require" });
  try {
    const db = drizzle(client, { schema });
    await ensureBaseData(db);
    const existing = await db.select({ id: products.id }).from(products).where(like(products.name, "[DEMO]%")).limit(1);
    if (existing[0]) {
      console.log("Dados de demonstração já existem. Nada foi alterado.");
      return;
    }
    const [store] = await db.select().from(stores).where(eq(stores.slug, "outra-loja")).limit(1);
    if (!store) throw new Error("Loja 'outra-loja' não encontrada. Rode npm run db:migrate.");

    const [product] = await db
      .insert(products)
      .values({
        name: DEMO_NAME,
        category: "Cozinha",
        brand: "Demo",
        model: "DEMO-AF-1",
        targetPriceCents: 39_900,
        maxBudgetCents: 49_900,
        priority: "media",
        status: "monitorando",
        notes: "Produto fictício para testar a interface. Não representa preço real de loja.",
      })
      .returning({ id: products.id });

    const offerDefs = [
      { label: "a", price: 42_990, shipping: 0, known: true },
      { label: "b", price: 44_900, shipping: 1_990, known: true },
    ];
    for (const def of offerDefs) {
      const [offer] = await db
        .insert(offers)
        .values({
          productId: product.id,
          storeId: store.id,
          url: `https://demo.invalid/produto/${def.label}`,
          dedupeKey: `demo:${def.label}`,
          title: `${DEMO_NAME} — oferta ${def.label}`,
          source: "demo",
          currentPriceCents: def.price,
          currentShippingCents: def.shipping,
          shippingKnown: def.known,
          currentAvailability: "disponivel",
          matchStatus: "confirmado",
          matchNotes: "Dado de demonstração.",
          lastCheckedAt: new Date(),
          lastSuccessAt: new Date(),
        })
        .returning({ id: offers.id });

      const now = Date.now();
      const history = [];
      for (let day = 30; day >= 0; day--) {
        const wobble = Math.round(Math.sin(day / 3 + def.price) * 1500);
        const price = def.price + 3_000 + wobble + (day < 3 ? -2_500 : 0);
        history.push({
          offerId: offer.id,
          productId: product.id,
          storeId: store.id,
          status: "sucesso" as const,
          priceCents: price,
          shippingCents: def.shipping,
          shippingKnown: def.known,
          totalCents: price + def.shipping,
          availability: "disponivel" as const,
          source: "demo",
          collectedAt: new Date(now - day * 86_400_000),
        });
      }
      await db.insert(priceHistory).values(history);
    }
    console.log(`Dados de demonstração criados (${DEMO_NAME}). Rótulo DEMO em todas as ofertas.`);
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
