import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { offers, products } from "@/db/schema";
import { searchMercadoLivre, type MercadoLivreSearchCandidate } from "../adapters/mercado-livre";
import type { MatchResult } from "../analysis/matching";
import { matchListing } from "../analysis/matching";

export interface OfferSearchCandidate extends MercadoLivreSearchCandidate {
  match: MatchResult;
  alreadyAdded: boolean;
}

export interface OfferSearchResult {
  query: string;
  candidates: OfferSearchCandidate[];
}

/**
 * Monta a consulta de busca a partir dos dados do produto.
 * Usa nome + marca + modelo, limitando o total de tokens para não degradar o resultado.
 */
export function buildSearchQuery(product: {
  name: string;
  brand: string | null;
  model: string | null;
  manufacturerCode?: string | null;
}): string {
  const parts = [product.name, product.brand, product.model, product.manufacturerCode]
    .filter((p): p is string => typeof p === "string" && p.trim() !== "")
    .map((p) => p.trim());
  const tokens = parts.join(" ").split(/\s+/).slice(0, 10);
  return tokens.join(" ").trim();
}

/**
 * Busca ofertas correspondentes ao produto na API oficial do Mercado Livre
 * (GET /sites/MLB/search) e as compara com o produto cadastrado usando as
 * mesmas regras de correspondência do restante do sistema. Anúncios que já
 * estão cadastrados como oferta do produto são marcados (não duplicar).
 */
export async function searchOffersForProduct(
  db: Db,
  args: { productId: string; fetchImpl?: typeof fetch; timeoutMs?: number; maxResults?: number },
): Promise<OfferSearchResult> {
  const [product] = await db.select().from(products).where(eq(products.id, args.productId)).limit(1);
  if (!product) throw new Error("Produto não encontrado.");

  const query = buildSearchQuery(product);
  if (!query) return { query: "", candidates: [] };

  const raw = await searchMercadoLivre(query, {
    timeoutMs: args.timeoutMs ?? 10_000,
    fetchImpl: args.fetchImpl ?? fetch,
    limit: args.maxResults ?? 20,
  });

  const existing = await db
    .select({ externalId: offers.externalId, url: offers.url })
    .from(offers)
    .where(and(eq(offers.productId, product.id), eq(offers.isActive, true)));
  const knownIds = new Set(existing.map((o) => o.externalId).filter((x): x is string => Boolean(x)));
  const knownUrls = new Set(existing.map((o) => o.url));

  const candidates = raw.map((c) => {
    const match = matchListing(
      { name: product.name, brand: product.brand, model: product.model, manufacturerCode: product.manufacturerCode, gtin: product.gtin },
      { title: c.title },
    );
    return {
      ...c,
      match,
      alreadyAdded: knownIds.has(c.externalId) || (c.permalink !== null && knownUrls.has(c.permalink)),
    };
  });
  return { query, candidates };
}
