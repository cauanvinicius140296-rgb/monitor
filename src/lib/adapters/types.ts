/**
 * Contrato dos adaptadores de fontes de preço.
 * Cada loja tem um adaptador independente que consulta a fonte e devolve dados padronizados.
 */

export type Availability = "disponivel" | "indisponivel" | "desconhecido";

export interface OfferRef {
  externalId: string | null;
  url: string;
}

/** Dados padronizados retornados por um adaptador. Valores monetários em centavos. */
export interface OfferSnapshot {
  priceCents: number | null;
  shippingCents: number | null;
  shippingKnown: boolean;
  availability: Availability;
  title?: string | null;
  imageUrl?: string | null;
  sellerName?: string | null;
  brand?: string | null;
  model?: string | null;
  gtin?: string | null;
  manufacturerCode?: string | null;
  /** Origem técnica do dado (ex.: api_mercado_livre). Gravado no histórico. */
  source: string;
}

export type SourceErrorCode =
  | "timeout"
  | "rate_limited"
  | "unavailable"
  | "not_found"
  | "unauthorized"
  | "parse_error"
  | "not_configured"
  | "unsupported_url"
  | "integration_pending";

export class SourceError extends Error {
  constructor(
    public readonly code: SourceErrorCode,
    message: string,
    public readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = "SourceError";
  }
}

export interface IdentifyResult {
  title: string | null;
  imageUrl: string | null;
  priceCents: number | null;
  shippingCents: number | null;
  shippingKnown: boolean;
  availability: Availability;
  brand: string | null;
  model: string | null;
  gtin: string | null;
  manufacturerCode: string | null;
  sellerName: string | null;
  externalId: string | null;
  canonicalUrl: string;
}

export interface FetchContext {
  timeoutMs: number;
  fetchImpl: typeof fetch;
}

export interface PriceSourceAdapter {
  /** Chave única do adaptador (registrada em registry.ts). */
  readonly key: string;
  /** Slug da loja correspondente em `stores`. */
  readonly storeSlug: string;
  /** "api": consulta automatizada autorizada. "pendente": requer credenciais/programa. */
  readonly mode: "api" | "pendente";
  /** Se pode ser consultado pelo agendador automaticamente. */
  readonly automated: boolean;
  /** Resumo de requisitos (documentação para o painel). */
  readonly requirements: string;

  /** Indica se as credenciais necessárias estão configuradas. */
  isConfigured(): boolean;
  /** Extrai o identificador do anúncio a partir da URL (sem acessar a rede). Null = URL não reconhecida. */
  parseUrl(url: URL): OfferRef | null;
  /** Consulta a fonte. Lança SourceError em falhas controladas. */
  fetchOffer(ref: OfferRef, ctx: FetchContext): Promise<OfferSnapshot>;
}
