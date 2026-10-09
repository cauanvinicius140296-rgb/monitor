/**
 * Catálogo de lojas (fonte única para seed do banco e para detecção por URL).
 * Para adicionar uma loja: crie um adaptador em src/lib/adapters, registre-o em
 * registry.ts e inclua uma entrada aqui.
 */
export interface StoreCatalogEntry {
  slug: string;
  name: string;
  domains: string[];
  adapterKey: string | null;
  integrationMode: "api" | "manual" | "pendente";
  automated: boolean;
  integrationNote: string;
}

export const STORE_CATALOG: StoreCatalogEntry[] = [
  {
    slug: "mercado-livre",
    name: "Mercado Livre",
    domains: ["mercadolivre.com.br", "mercadolibre.com.br"],
    adapterKey: "mercado_livre",
    integrationMode: "api",
    automated: true,
    integrationNote:
      "API oficial GET /items/{id}. Leitura pública costuma funcionar sem token; se houver 401/403, configure MERCADO_LIVRE_ACCESS_TOKEN (aplicação em developers.mercadolivre.com.br).",
  },
  {
    slug: "amazon-br",
    name: "Amazon Brasil",
    domains: ["amazon.com.br"],
    adapterKey: "amazon_br",
    integrationMode: "pendente",
    automated: false,
    integrationNote:
      "Sem coleta automática. Requer a Product Advertising API 5 (Programa de Associados aprovado, com vendas qualificadas) e credenciais. Até lá: atualização manual.",
  },
  {
    slug: "magalu",
    name: "Magazine Luiza (Magalu)",
    domains: ["magazineluiza.com.br", "magalu.com.br"],
    adapterKey: "magalu",
    integrationMode: "pendente",
    automated: false,
    integrationNote:
      "Sem coleta automática. Requer cadastro no programa de parceiros/API da Magalu e credenciais aprovadas. Até lá: atualização manual.",
  },
  {
    slug: "fast-shop",
    name: "Fast Shop",
    domains: ["fastshop.com.br"],
    adapterKey: "fast_shop",
    integrationMode: "pendente",
    automated: false,
    integrationNote:
      "Sem API pública documentada para monitoramento. Sem coleta automática; use atualização manual.",
  },
  {
    slug: "outra-loja",
    name: "Outra loja",
    domains: [],
    adapterKey: null,
    integrationMode: "manual",
    automated: false,
    integrationNote: "Cadastro manual de qualquer outra loja. O preço é informado pelo usuário.",
  },
];

export function detectStoreSlugByHost(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  for (const store of STORE_CATALOG) {
    for (const domain of store.domains) {
      if (host === domain || host.endsWith(`.${domain}`)) return store.slug;
    }
  }
  return null;
}

export function getStoreNameBySlug(slug: string): string {
  return STORE_CATALOG.find((s) => s.slug === slug)?.name ?? "Outra loja";
}
