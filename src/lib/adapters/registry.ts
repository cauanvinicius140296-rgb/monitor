import type { PriceSourceAdapter } from "./types";
import { createMercadoLivreAdapter } from "./mercado-livre";
import { amazonAdapter, fastShopAdapter, magaluAdapter } from "./pending";
import { STORE_CATALOG, detectStoreSlugByHost } from "../stores-catalog";

/** Todos os adaptadores conhecidos. Novas lojas entram aqui. */
export function allAdapters(): PriceSourceAdapter[] {
  return [createMercadoLivreAdapter(), amazonAdapter, magaluAdapter, fastShopAdapter];
}

export function getAdapterByKey(key: string | null | undefined): PriceSourceAdapter | null {
  if (!key) return null;
  return allAdapters().find((a) => a.key === key) ?? null;
}

export function getAdapterForStoreSlug(slug: string): PriceSourceAdapter | null {
  const entry = STORE_CATALOG.find((s) => s.slug === slug);
  return getAdapterByKey(entry?.adapterKey ?? null);
}

/** Identifica a loja pela URL (apenas pelo host; não acessa a rede). */
export function identifyStoreFromUrl(url: URL): { storeSlug: string; adapter: PriceSourceAdapter | null } {
  const slug = detectStoreSlugByHost(url.hostname) ?? "outra-loja";
  return { storeSlug: slug, adapter: getAdapterForStoreSlug(slug) };
}
