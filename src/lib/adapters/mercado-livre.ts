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

/** Token usado pelas funções de busca/teste de conexão (mesma fonte do adaptador). */
function resolveToken(getAccessToken?: () => string | undefined): string | undefined {
  return (getAccessToken ?? (() => process.env.MERCADO_LIVRE_ACCESS_TOKEN?.trim() || undefined))();
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

/** Candidato de oferta encontrado pela busca oficial do Mercado Livre. */
export interface MercadoLivreSearchCandidate {
  externalId: string;
  title: string | null;
  priceCents: number | null;
  currency: string | null;
  permalink: string | null;
  imageUrl: string | null;
  freeShipping: boolean;
  sellerName: string | null;
}

/**
 * Converte o JSON de GET /sites/MLB/search em candidatos padronizados.
 * Função pura (testada com fixtures). Resultados sem ID válido ou em moeda
 * diferente de BRL são ignorados; sem preço, o candidato entra com preço null.
 */
export function mapMercadoLivreSearchResults(payload: unknown, maxResults = 20): MercadoLivreSearchCandidate[] {
  if (!payload || typeof payload !== "object") {
    throw new SourceError("parse_error", "Resposta da busca do Mercado Livre em formato inesperado.");
  }
  const results = (payload as { results?: unknown }).results;
  if (!Array.isArray(results)) {
    throw new SourceError("parse_error", "A busca do Mercado Livre não retornou a lista de resultados.");
  }
  const out: MercadoLivreSearchCandidate[] = [];
  for (const item of results) {
    if (out.length >= maxResults) break;
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    const id = typeof it.id === "string" ? it.id : "";
    if (!/^MLB\d{6,}$/.test(id)) continue;
    const currency = typeof it.currency_id === "string" ? it.currency_id : null;
    if (currency && currency !== "BRL") continue;
    const price = typeof it.price === "number" && Number.isFinite(it.price) ? Math.round(it.price * 100) : null;
    const shipping = it.shipping as { free_shipping?: unknown } | undefined;
    const permalink = typeof it.permalink === "string" ? it.permalink : null;
    const thumb = typeof it.thumbnail === "string" ? it.thumbnail : null;
    const seller = it.seller as { nickname?: unknown } | undefined;
    out.push({
      externalId: id,
      title: typeof it.title === "string" ? it.title.slice(0, 300) : null,
      priceCents: price,
      currency,
      permalink: permalink && permalink.startsWith("https://") ? permalink : null,
      imageUrl: thumb && (thumb.startsWith("https://") || thumb.startsWith("http://"))
        ? thumb.replace(/^http:/, "https:")
        : null,
      freeShipping: shipping?.free_shipping === true,
      sellerName: typeof seller?.nickname === "string" ? seller.nickname.slice(0, 160) : null,
    });
  }
  return out;
}

function mlHeaders(token: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function mapMlHttpError(status: number, context: string): SourceError {
  if (status === 401 || status === 403) {
    return new SourceError(
      "unauthorized",
      `A API do Mercado Livre recusou ${context} (HTTP ${status}). Verifique MERCADO_LIVRE_ACCESS_TOKEN e as permissões da aplicação.`,
    );
  }
  if (status === 429) return new SourceError("rate_limited", "Limite de requisições do Mercado Livre atingido.", true);
  if (status >= 500) return new SourceError("unavailable", `API do Mercado Livre indisponível (HTTP ${status}).`, true);
  return new SourceError("unavailable", `Resposta inesperada da API do Mercado Livre (HTTP ${status}).`);
}

async function fetchMlJson(
  url: string,
  opts: { timeoutMs: number; fetchImpl: typeof fetch; token: string | undefined; context: string },
): Promise<unknown> {
  let response: Response;
  try {
    response = await opts.fetchImpl(url, {
      headers: mlHeaders(opts.token),
      redirect: "error",
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (err) {
    const name = (err as { name?: string })?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new SourceError("timeout", "Tempo esgotado ao consultar o Mercado Livre.", true);
    }
    throw new SourceError("unavailable", "Não foi possível conectar à API do Mercado Livre.", true);
  }
  if (!response.ok) throw mapMlHttpError(response.status, opts.context);
  try {
    return await response.json();
  } catch {
    throw new SourceError("parse_error", "Resposta da API do Mercado Livre não é JSON válido.");
  }
}

/**
 * Busca anúncios no Mercado Livre pelo endpoint oficial GET /sites/MLB/search.
 * Usada para descobrir ofertas de um produto em várias lojas/anunciantes dentro do ML.
 */
export async function searchMercadoLivre(
  query: string,
  opts: { timeoutMs: number; fetchImpl: typeof fetch; getAccessToken?: () => string | undefined; limit?: number },
): Promise<MercadoLivreSearchCandidate[]> {
  const q = query.trim();
  if (!q) return [];
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
  const url = `${ML_API_BASE}/sites/MLB/search?q=${encodeURIComponent(q)}&limit=${limit}`;
  const json = await fetchMlJson(url, {
    timeoutMs: opts.timeoutMs,
    fetchImpl: opts.fetchImpl,
    token: resolveToken(opts.getAccessToken),
    context: "a busca",
  });
  return mapMercadoLivreSearchResults(json, limit);
}

export interface MercadoLivreConnectionReport {
  ok: boolean;
  message: string;
  tokenPresent: boolean;
  searchOk: boolean | null;
  resultCount: number | null;
  identity: string | null;
}

/**
 * Testa a integração real com a API do Mercado Livre a partir do servidor:
 * 1. GET /sites/MLB/search?q=teste&limit=1 (funciona sem token em leitura pública);
 * 2. se houver token, GET /users/me para validar identidade/permissões.
 * Nunca imprime o token; apenas relata sucesso ou o motivo da falha.
 */
export async function testMercadoLivreConnection(opts: {
  timeoutMs: number;
  fetchImpl: typeof fetch;
  getAccessToken?: () => string | undefined;
}): Promise<MercadoLivreConnectionReport> {
  const token = resolveToken(opts.getAccessToken);
  const report: MercadoLivreConnectionReport = {
    ok: false,
    message: "",
    tokenPresent: Boolean(token),
    searchOk: null,
    resultCount: null,
    identity: null,
  };
  try {
    const json = await fetchMlJson(`${ML_API_BASE}/sites/MLB/search?q=teste&limit=1`, {
      timeoutMs: opts.timeoutMs,
      fetchImpl: opts.fetchImpl,
      token,
      context: "a busca de teste",
    });
    const results = mapMercadoLivreSearchResults(json, 1);
    report.searchOk = true;
    report.resultCount = results.length;
  } catch (err) {
    report.searchOk = false;
    report.message = err instanceof SourceError ? err.message : "Falha inesperada no teste de conexão.";
    return report;
  }
  if (token) {
    try {
      const json = (await fetchMlJson(`${ML_API_BASE}/users/me`, {
        timeoutMs: opts.timeoutMs,
        fetchImpl: opts.fetchImpl,
        token,
        context: "a validação do token",
      })) as { nickname?: unknown; site_id?: unknown };
      report.identity = typeof json.nickname === "string" ? json.nickname : null;
      report.ok = true;
      report.message = `Conexão válida: busca funciona e o token foi aceito${report.identity ? ` (conta: ${report.identity})` : ""}.`;
    } catch (err) {
      report.message = `Busca funciona, mas o token foi recusado: ${err instanceof SourceError ? err.message : "falha inesperada."} A coleta por item pode continuar funcionando se a leitura pública for permitida.`;
      report.ok = true; // busca ok: a integração principal funciona; o token é opcional
    }
    return report;
  }
  report.ok = true;
  report.message = "Conexão válida: a API respondeu à busca sem token. Se a consulta por item (GET /items/{id}) for recusada, configure MERCADO_LIVRE_ACCESS_TOKEN.";
  return report;
}
