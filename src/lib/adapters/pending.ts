import type { OfferRef, PriceSourceAdapter } from "./types";
import { SourceError } from "./types";
import { hostMatchesDomain } from "../security/url";

interface PendingOptions {
  key: string;
  storeSlug: string;
  name: string;
  domains: string[];
  requirements: string;
  extractId: (url: URL) => string | null;
}

/**
 * Adaptador para lojas cuja integração automatizada ainda não é permitida/configurada.
 * Reconhece a URL (para cadastro) mas NÃO consulta a loja. A coleta fica manual.
 */
export function createPendingAdapter(opts: PendingOptions): PriceSourceAdapter {
  return {
    key: opts.key,
    storeSlug: opts.storeSlug,
    mode: "pendente",
    automated: false,
    requirements: opts.requirements,
    isConfigured: () => false,
    parseUrl(url: URL): OfferRef | null {
      if (!opts.domains.some((d) => hostMatchesDomain(url.hostname, d))) return null;
      return { externalId: opts.extractId(url), url: url.toString() };
    },
    async fetchOffer(): Promise<never> {
      throw new SourceError(
        "integration_pending",
        `Integração com ${opts.name} pendente: ${opts.requirements} Use a atualização manual.`,
      );
    },
  };
}

export const amazonAdapter = createPendingAdapter({
  key: "amazon_br",
  storeSlug: "amazon-br",
  name: "Amazon Brasil",
  domains: ["amazon.com.br"],
  requirements: "Requer PA-API 5 (Programa de Associados) e credenciais.",
  extractId: (url) => /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i.exec(url.pathname)?.[1]?.toUpperCase() ?? null,
});

export const magaluAdapter = createPendingAdapter({
  key: "magalu",
  storeSlug: "magalu",
  name: "Magazine Luiza",
  domains: ["magazineluiza.com.br", "magalu.com.br"],
  requirements: "Requer cadastro no programa de parceiros/API da Magalu e credenciais.",
  extractId: (url) => /\/p\/([a-z0-9]+)\//i.exec(url.pathname)?.[1] ?? null,
});

export const fastShopAdapter = createPendingAdapter({
  key: "fast_shop",
  storeSlug: "fast-shop",
  name: "Fast Shop",
  domains: ["fastshop.com.br"],
  requirements: "Sem API pública documentada para monitoramento.",
  extractId: (url) => /(\d{5,})\/?$/.exec(url.pathname)?.[1] ?? null,
});
