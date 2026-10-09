import type { Availability, FetchContext, OfferRef, OfferSnapshot, PriceSourceAdapter } from "./types";
import { SourceError } from "./types";
import { hostMatchesDomain } from "../security/url";

export const ML_API_BASE = "https://api.mercadolibre.com";
export const ML_SOURCE_TAG = "api_mercado_livre";

const ML_DOMAINS = ["mercadolivre.com.br", "mercadolibre.com.br"];

/** Extrai o ID do anúncio (MLB + dígitos) de uma URL do Mercado Livre. */
export function parseMercadoLivreUrl(url: URL): OfferRef | null {
  if (!ML_DOMAINS.some((d) => hostMatchesDomain(url.hostname, d))) return null;
  const path = url.pathname;
  // Página de catálogo (/p/MLBxxxx): não é um anúncio. Só aceitamos se houver um anúncio explícito.
  if (/\/p\/MLB\d+/i.test(path)) {
    const wid = url.searchParams.get("wid") ?? url.searchParams.get("item_id");
    const m = wid ? /^MLB-?(\d{6,})$/i.exec(wid) : null;
    if (!m) return null;
    return { externalId: `MLB${m[1]}`, url: url.toString() };
  }
  const m = /MLB-?(\d{6,})/i.exec(path) ?? /MLB-?(\d{6,})/i.exec(url.search);
  if (!m) return null;
  return { externalId: `MLB${m[1]}`, url: url.toString() };
}

/** Converte o JSON de GET /items/{id} em dados padronizados. Função pura (testada com fixtures). */
export function mapMercadoLivreItem(item: unknown): OfferSnapshot {
  if (!item || typeof item !== "object") {
    throw new SourceError("parse_error", "Resposta da API do Mercado Livre em formato inesperado.");
  }
  const it = item as Record<string, unknown>;
  if (it.site_id !== undefined && it.site_id !== "MLB") {
    throw new SourceError("parse_error", `Site inesperado na resposta: ${String(it.site_id)}.`);
  }
  if (it.currency_id !== undefined && it.currency_id !== "BRL") {
    throw new SourceError("parse_error", `Moeda inesperada: ${String(it.currency_id)}.`);
  }
  const price = typeof it.price === "number" ? it.price : null;
  if (price === null || !Number.isFinite(price) || price <= 0) {
    throw new SourceError("parse_error", "A API não retornou um preço válido para o anúncio.");
  }
  const priceCents = Math.round(price * 100);

  const status = typeof it.status === "string" ? it.status : "";
  const qty = typeof it.available_quantity === "number" ? it.available_quantity : null;
  let availability: Availability = "desconhecido";
  if (status === "active") {
    availability = qty === 0 ? "indisponivel" : "disponivel";
  } else if (["paused", "closed", "inactive"].includes(status)) {
    availability = "indisponivel";
  }

  const shipping = it.shipping as { free_shipping?: unknown } | undefined;
  const freeShipping = shipping?.free_shipping === true;

  const attrs = Array.isArray(it.attributes) ? (it.attributes as Array<Record<string, unknown>>) : [];
  const attr = (id: string): string | null => {
    const found = attrs.find((a) => a.id === id);
    const value = found?.value_name;
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  };

  const pictures = Array.isArray(it.pictures) ? (it.pictures as Array<Record<string, unknown>>) : [];
  const firstPicture = pictures[0];
  const imageUrl =
    (typeof firstPicture?.secure_url === "string" && firstPicture.secure_url) ||
    (typeof firstPicture?.url === "string" && firstPicture.url) ||
    (typeof it.thumbnail === "string" && it.thumbnail) ||
    null;

  return {
    priceCents,
    shippingCents: freeShipping ? 0 : null,
    shippingKnown: freeShipping,
    availability,
    title: typeof it.title === "string" ? it.title : null,
    imageUrl: imageUrl && imageUrl.startsWith("https://") ? imageUrl : null,
    sellerName: null,
    brand: attr("BRAND"),
    model: attr("MODEL"),
    gtin: attr("GTIN"),
    manufacturerCode: attr("MANUFACTURER_CODE") ?? attr("PART_NUMBER"),
    source: ML_SOURCE_TAG,
  };
}

export interface MercadoLivreOptions {
  getAccessToken?: () => string | undefined;
}

export function createMercadoLivreAdapter(options: MercadoLivreOptions = {}): PriceSourceAdapter {
  const getToken = options.getAccessToken ?? (() => process.env.MERCADO_LIVRE_ACCESS_TOKEN?.trim() || undefined);
  return {
    key: "mercado_livre",
    storeSlug: "mercado-livre",
    mode: "api",
    automated: true,
    requirements:
      "API oficial do Mercado Livre (GET /items/{id}). Token opcional (MERCADO_LIVRE_ACCESS_TOKEN) se a leitura for recusada.",
    isConfigured: () => true,
    parseUrl: parseMercadoLivreUrl,
    async fetchOffer(ref: OfferRef, ctx: FetchContext): Promise<OfferSnapshot> {
      if (!ref.externalId || !/^MLB\d{6,}$/.test(ref.externalId)) {
        throw new SourceError("unsupported_url", "Identificador do anúncio Mercado Livre ausente ou inválido.");
      }
      const headers: Record<string, string> = { Accept: "application/json" };
      const token = getToken();
      if (token) headers.Authorization = `Bearer ${token}`;

      let response: Response;
      try {
        response = await ctx.fetchImpl(`${ML_API_BASE}/items/${ref.externalId}`, {
          headers,
          redirect: "error",
          signal: AbortSignal.timeout(ctx.timeoutMs),
        });
      } catch (err) {
        const name = (err as { name?: string })?.name;
        if (name === "TimeoutError" || name === "AbortError") {
          throw new SourceError("timeout", "Tempo esgotado ao consultar o Mercado Livre.", true);
        }
        throw new SourceError("unavailable", "Não foi possível conectar à API do Mercado Livre.", true);
      }

      if (response.status === 404) {
        throw new SourceError("not_found", "Anúncio não encontrado (pode ter sido removido ou pausado).");
      }
      if (response.status === 401 || response.status === 403) {
        throw new SourceError(
          "unauthorized",
          `A API do Mercado Livre recusou a consulta (HTTP ${response.status}). Verifique MERCADO_LIVRE_ACCESS_TOKEN e as permissões da aplicação.`,
        );
      }
      if (response.status === 429) {
        throw new SourceError("rate_limited", "Limite de requisições do Mercado Livre atingido.", true);
      }
      if (response.status >= 500) {
        throw new SourceError("unavailable", `API do Mercado Livre indisponível (HTTP ${response.status}).`, true);
      }
      if (!response.ok) {
        throw new SourceError("unavailable", `Resposta inesperada da API do Mercado Livre (HTTP ${response.status}).`);
      }
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        throw new SourceError("parse_error", "Resposta da API do Mercado Livre não é JSON válido.");
      }
      return mapMercadoLivreItem(json);
    },
  };
}
