import { sql } from "drizzle-orm";
import { getDb, closeDb } from "@/db/client";
import { ensureBaseData } from "@/db/bootstrap";
import { productFormSchema, type ProductFormInput } from "@/lib/validation/schemas";
import { DEFAULT_SETTINGS } from "@/lib/settings-defaults";
import { SourceError, type OfferRef, type OfferSnapshot, type PriceSourceAdapter } from "@/lib/adapters/types";

export { getDb, closeDb };

/** Limpa os dados de negócio entre os testes (mantém lojas e o job de coleta). */
export async function resetData(): Promise<void> {
  const db = getDb();
  await ensureBaseData(db);
  await db.execute(sql`
    TRUNCATE alerts, alert_states, price_history, purchases, shopping_list_items, shopping_lists,
             offers, products, monitoring_runs, rate_limits, sessions, settings
    RESTART IDENTITY CASCADE
  `);
  await db.execute(sql`UPDATE monitoring_jobs SET locked_until = NULL, locked_by = NULL, last_status = NULL`);
  await db.execute(sql`UPDATE stores SET consecutive_failures = 0, last_success_at = NULL, last_failure_at = NULL, last_error = NULL`);
}

/** Produto válido, passando pela mesma validação do formulário. */
export function productInput(over: Partial<Record<string, string>> = {}): ProductFormInput {
  const parsed = productFormSchema.parse({
    name: "Air fryer 5L Exemplo",
    category: "Eletrodomésticos",
    subcategory: "",
    brand: "Exemplo",
    model: "AF-5000",
    manufacturerCode: "",
    gtin: "",
    imageUrl: "",
    referenceUrl: "",
    targetPriceCents: "300,00",
    maxBudgetCents: "",
    referencePriceCents: "",
    notes: "",
    priority: "alta",
    status: "monitorando",
    ...over,
  });
  return parsed;
}

export const noSleep = async () => {};

/** Adaptador falso para a coleta: respostas configuradas por anúncio (dados simulados, só em teste). */
export function fakeMercadoLivre(responder: (externalId: string | null) => OfferSnapshot | SourceError): {
  adapter: PriceSourceAdapter;
  calls: string[];
} {
  const calls: string[] = [];
  const adapter: PriceSourceAdapter = {
    key: "mercado_livre",
    storeSlug: "mercado-livre",
    mode: "api",
    automated: true,
    requirements: "fake (teste)",
    isConfigured: () => true,
    parseUrl: () => null,
    async fetchOffer(ref: OfferRef) {
      calls.push(ref.externalId ?? "");
      const result = responder(ref.externalId);
      if (result instanceof SourceError) throw result;
      return result;
    },
  };
  return { adapter, calls };
}

export function snapshot(priceCents: number, over: Partial<OfferSnapshot> = {}): OfferSnapshot {
  return {
    priceCents,
    shippingCents: 0,
    shippingKnown: true,
    availability: "disponivel",
    title: "Air fryer 5L Exemplo (teste)",
    imageUrl: null,
    sellerName: null,
    brand: "Exemplo",
    model: "AF-5000",
    gtin: null,
    manufacturerCode: null,
    source: "api_mercado_livre",
    ...over,
  };
}

export const TEST_SETTINGS = { ...DEFAULT_SETTINGS };
