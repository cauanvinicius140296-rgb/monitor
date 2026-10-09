import { describe, expect, it } from "vitest";
import { createMercadoLivreAdapter, mapMercadoLivreItem, parseMercadoLivreUrl } from "@/lib/adapters/mercado-livre";
import { SourceError } from "@/lib/adapters/types";

// Fixture no formato de GET /items/{id} (campos usados pelo adaptador). Dados fictícios.
const FIXTURE_ITEM = {
  id: "MLB1234567890",
  site_id: "MLB",
  title: "Air Fryer Exemplo 5L Preta",
  category_id: "MLB1234",
  price: 299.9,
  original_price: 399.9,
  currency_id: "BRL",
  available_quantity: 12,
  status: "active",
  permalink: "https://produto.mercadolivre.com.br/MLB-1234567890-air-fryer-exemplo-_JM",
  thumbnail: "http://http2.mlstatic.com/thumb.jpg",
  pictures: [{ secure_url: "https://http2.mlstatic.com/D_NQ_NP_1-F.jpg" }],
  shipping: { free_shipping: true },
  attributes: [
    { id: "BRAND", value_name: "Exemplo" },
    { id: "MODEL", value_name: "AF-5000" },
    { id: "GTIN", value_name: "7891234567895" },
  ],
};

function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    return handler(url, init ?? {});
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const ctx = (fetchImpl: typeof fetch) => ({ timeoutMs: 5_000, fetchImpl });
const REF = { externalId: "MLB1234567890", url: "https://produto.mercadolivre.com.br/MLB-1234567890-x" };

describe("Mercado Livre — interpretação do item (fixtures)", () => {
  it("converte preço em centavos e identifica frete grátis, marca, modelo e GTIN", () => {
    const s = mapMercadoLivreItem(FIXTURE_ITEM);
    expect(s.priceCents).toBe(29_990);
    expect(s.availability).toBe("disponivel");
    expect(s.shippingKnown).toBe(true);
    expect(s.shippingCents).toBe(0);
    expect(s.brand).toBe("Exemplo");
    expect(s.model).toBe("AF-5000");
    expect(s.gtin).toBe("7891234567895");
    expect(s.imageUrl).toBe("https://http2.mlstatic.com/D_NQ_NP_1-F.jpg");
    expect(s.source).toBe("api_mercado_livre");
  });

  it("anúncio pausado ou sem estoque é indisponível", () => {
    expect(mapMercadoLivreItem({ ...FIXTURE_ITEM, status: "paused" }).availability).toBe("indisponivel");
    expect(mapMercadoLivreItem({ ...FIXTURE_ITEM, available_quantity: 0 }).availability).toBe("indisponivel");
  });

  it("frete não informado como grátis fica desconhecido (não inventa custo)", () => {
    const s = mapMercadoLivreItem({ ...FIXTURE_ITEM, shipping: { free_shipping: false } });
    expect(s.shippingKnown).toBe(false);
    expect(s.shippingCents).toBeNull();
  });

  it("rejeita resposta sem preço válido ou de outro site/moeda", () => {
    expect(() => mapMercadoLivreItem({ ...FIXTURE_ITEM, price: undefined })).toThrow(SourceError);
    expect(() => mapMercadoLivreItem({ ...FIXTURE_ITEM, currency_id: "USD" })).toThrow(SourceError);
    expect(() => mapMercadoLivreItem({ ...FIXTURE_ITEM, site_id: "MLA" })).toThrow(SourceError);
    expect(() => mapMercadoLivreItem(null)).toThrow(SourceError);
  });

  it("extrai o MLB da URL de anúncio, mas não de página de catálogo sem wid", () => {
    expect(parseMercadoLivreUrl(new URL(FIXTURE_ITEM.permalink))?.externalId).toBe("MLB1234567890");
    expect(parseMercadoLivreUrl(new URL("https://www.mercadolivre.com.br/p/MLB12345678"))).toBeNull();
    expect(parseMercadoLivreUrl(new URL("https://www.mercadolivre.com.br/p/MLB12345678?wid=MLB987654321"))?.externalId).toBe("MLB987654321");
    expect(parseMercadoLivreUrl(new URL("https://www.amazon.com.br/dp/B000"))).toBeNull();
  });
});

describe("Mercado Livre — consulta à API (fetch simulado)", () => {
  it("consulta GET /items/{id} sem redirecionar e sem token quando não configurado", async () => {
    const { fn, calls } = fakeFetch(() => Response.json(FIXTURE_ITEM));
    const adapter = createMercadoLivreAdapter({ getAccessToken: () => undefined });
    const snap = await adapter.fetchOffer(REF, ctx(fn));
    expect(snap.priceCents).toBe(29_990);
    expect(calls[0].url).toBe("https://api.mercadolibre.com/items/MLB1234567890");
    expect(calls[0].init.redirect).toBe("error");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("envia Bearer quando o token está configurado", async () => {
    const { fn, calls } = fakeFetch(() => Response.json(FIXTURE_ITEM));
    const adapter = createMercadoLivreAdapter({ getAccessToken: () => "token-fictico" });
    await adapter.fetchOffer(REF, ctx(fn));
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer token-fictico");
  });

  const cases: [string, number, string, boolean][] = [
    ["404 → não encontrado, não tenta de novo", 404, "not_found", false],
    ["401 → não autorizado, sem retry", 401, "unauthorized", false],
    ["403 → não autorizado, sem retry", 403, "unauthorized", false],
    ["429 → limite de requisições, com retry", 429, "rate_limited", true],
    ["500 → indisponível, com retry", 500, "unavailable", true],
  ];
  for (const [label, status, code, retryable] of cases) {
    it(`trata ${label}`, async () => {
      const { fn } = fakeFetch(() => new Response("{}", { status }));
      const adapter = createMercadoLivreAdapter({ getAccessToken: () => undefined });
      const err = await adapter.fetchOffer(REF, ctx(fn)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SourceError);
      expect((err as SourceError).code).toBe(code);
      expect((err as SourceError).retryable).toBe(retryable);
    });
  }

  it("falha de rede é indisponibilidade (com retry)", async () => {
    const { fn } = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    const adapter = createMercadoLivreAdapter({ getAccessToken: () => undefined });
    const err = (await adapter.fetchOffer(REF, ctx(fn)).catch((e: unknown) => e)) as SourceError;
    expect(err.code).toBe("unavailable");
    expect(err.retryable).toBe(true);
  });

  it("não consulta a API sem identificador MLB válido", async () => {
    const { fn, calls } = fakeFetch(() => Response.json(FIXTURE_ITEM));
    const adapter = createMercadoLivreAdapter({ getAccessToken: () => undefined });
    const err = (await adapter.fetchOffer({ externalId: null, url: "x" }, ctx(fn)).catch((e: unknown) => e)) as SourceError;
    expect(err.code).toBe("unsupported_url");
    expect(calls).toHaveLength(0);
  });
});
