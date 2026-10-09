import { identifyStoreFromUrl } from "../adapters/registry";
import { SourceError, type IdentifyResult } from "../adapters/types";
import { canonicalizeUrl, parseUserProductUrl, UnsafeUrlError } from "../security/url";
import { getStoreNameBySlug } from "../stores-catalog";

export type IdentifyOutcome =
  | {
      ok: true;
      storeSlug: string;
      storeName: string;
      identified: IdentifyResult | null;
      externalId: string | null;
      canonicalUrl: string;
      message: string;
    }
  | { ok: false; message: string };

/**
 * Tenta identificar nome, imagem, preço, marca, modelo e GTIN a partir da URL.
 * - Só consulta a loja por adaptador oficial/configurado (sem buscar páginas arbitrárias).
 * - Falha de identificação nunca impede o cadastro manual: retorna mensagem explicativa.
 */
export async function identifyFromUrl(
  raw: string,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<IdentifyOutcome> {
  let url: URL;
  try {
    url = parseUserProductUrl(raw);
  } catch (err) {
    return { ok: false, message: err instanceof UnsafeUrlError ? err.message : "URL inválida." };
  }
  const { storeSlug, adapter } = identifyStoreFromUrl(url);
  const storeName = getStoreNameBySlug(storeSlug);
  const canonicalUrl = canonicalizeUrl(url);
  const ref = adapter?.parseUrl(url) ?? null;
  const externalId = ref?.externalId ?? null;

  if (!adapter) {
    return {
      ok: true,
      storeSlug,
      storeName,
      identified: null,
      externalId: null,
      canonicalUrl,
      message: "Loja sem integração: preencha os dados manualmente.",
    };
  }
  if (!adapter.isConfigured() || adapter.mode !== "api") {
    return {
      ok: true,
      storeSlug,
      storeName,
      identified: null,
      externalId,
      canonicalUrl,
      message: `${storeName}: identificação automática indisponível (integração pendente). Preencha manualmente.`,
    };
  }
  if (!ref || !ref.externalId) {
    return {
      ok: true,
      storeSlug,
      storeName,
      identified: null,
      externalId: null,
      canonicalUrl,
      message:
        "Não foi possível identificar o anúncio nesta URL. Use o link do anúncio específico (com o código MLB) ou preencha manualmente.",
    };
  }

  try {
    const snap = await adapter.fetchOffer(ref, {
      timeoutMs: opts.timeoutMs ?? 10_000,
      fetchImpl: opts.fetchImpl ?? fetch,
    });
    return {
      ok: true,
      storeSlug,
      storeName,
      externalId: ref.externalId,
      canonicalUrl,
      identified: {
        title: snap.title ?? null,
        imageUrl: snap.imageUrl ?? null,
        priceCents: snap.priceCents,
        shippingCents: snap.shippingCents,
        shippingKnown: snap.shippingKnown,
        availability: snap.availability,
        brand: snap.brand ?? null,
        model: snap.model ?? null,
        gtin: snap.gtin ?? null,
        manufacturerCode: snap.manufacturerCode ?? null,
        sellerName: snap.sellerName ?? null,
        externalId: ref.externalId,
        canonicalUrl,
      },
      message: "Dados identificados automaticamente. Revise antes de salvar.",
    };
  } catch (err) {
    const msg = err instanceof SourceError ? err.message : "Falha inesperada ao identificar.";
    return {
      ok: true,
      storeSlug,
      storeName,
      identified: null,
      externalId: ref.externalId,
      canonicalUrl,
      message: `Não foi possível identificar automaticamente: ${msg} Preencha manualmente.`,
    };
  }
}
