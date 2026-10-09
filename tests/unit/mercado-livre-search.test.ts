import { describe, expect, it } from "vitest";
import {
  mapMercadoLivreSearchResults,
  searchMercadoLivre,
  testMercadoLivreConnection,
  ML_API_BASE,
} from "@/lib/adapters/mercado-livre";
import { SourceError } from "@/lib/adapters/types";
import { buildSearchQuery } from "@/lib/services/search-offers";

function fakeFetch(handler: (url: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    return handler(url);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const SEARCH_PAYLOAD = {
  results: [
    {
      id: "MLB9000000001",
      title: "Air Fryer Exemplo 5L Preta",
      price: 299.9,
      currency_id: "BRL",
      permalink: "https://produto.mercadolivre.com.br/MLB-9000000001-x-_JM",
      thumbnail: "http://http2.mlstatic.com/thumb1.jpg",
      shipping: { free_shipping: true },
      seller: { nickname: "LOJA_EXEMPLO" },
    },
    {
      id: "MLB9000000002",
      title: "Air Fryer Outra 12L",
      price: 499.0,
      currency_id: "BRL",
      permalink: "https://produto.mercadolivre.com.br/MLB-9000000002-y-_JM",
      thumbnail: "https://http2.mlstatic.com/thumb2.jpg",
      shipping: { free_shipping: false },
    },
  ],
};

describe("busca no Mercado Livre (fixtures)", () => {
  it("mapeia resultados com preço em centavos, frete grátis, vendedor e imagem https", () => {
    const out = mapMercadoLivreSearchResults(SEARCH_PAYLOAD);
    expect(out).toHaveLength(2);
    expect(out[0].externalId).toBe("MLB9000000001");
    expect(out[0].priceCents).toBe(29_990);
    expect(out[0].freeShipping).toBe(true);
    expect(out[0].sellerName).toBe("LOJA_EXEMPLO");
    expect(out[0].imageUrl).toBe("https://http2.mlstatic.com/thumb1.jpg");
    expect(out[1].freeShipping).toBe(false);
  });

  it("ignora id inválido e moeda diferente de BRL; sem preço entra como null (nunca inventa valor)", () => {
    const out = mapMercadoLivreSearchResults({
      results: [
        { id: "INVALID", title: "x", price: 10, currency_id: "BRL", permalink: "https://x" },
        { id: "MLB9000000003", title: "sem preço", currency_id: "BRL", permalink: "https://x" },
        { id: "MLB9000000004", title: "dólar", price: 10, currency_id: "USD", permalink: "https://x" },
        { id: "MLB9000000005", title: "válido", price: 12.5, currency_id: "BRL", permalink: "https://ok" },
      ],
    });
    expect(out.map((c) => c.externalId)).toEqual(["MLB9000000003", "MLB9000000005"]);
    expect(out[0].priceCents).toBeNull();
    expect(out[1].priceCents).toBe(1_250);
  });

  it("respeita o limite de resultados", () => {
    const many = { results: Array.from({ length: 60 }, (_, i) => ({ id: `MLB${1000000000 + i}`, price: 1, currency_id: "BRL" })) };
    expect(mapMercadoLivreSearchResults(many, 20)).toHaveLength(20);
  });

  it("resposta fora do formato gera SourceError de parse", () => {
    expect(() => mapMercadoLivreSearchResults(null)).toThrowError(SourceError);
    expect(() => mapMercadoLivreSearchResults({ anything: 1 })).toThrowError(SourceError);
  });

  it("searchMercadoLivre consulta o endpoint oficial com a query codificada", async () => {
    const { fn, calls } = fakeFetch(() => Response.json(SEARCH_PAYLOAD));
    const out = await searchMercadoLivre("air fryer 5l", { timeoutMs: 5_000, fetchImpl: fn });
    expect(out).toHaveLength(2);
    expect(calls[0]).toContain(`${ML_API_BASE}/sites/MLB/search?q=air%20fryer%205l`);
  });

  it("busca vazia não faz requisição", async () => {
    const { fn, calls } = fakeFetch(() => Response.json({ results: [] }));
    const out = await searchMercadoLivre("   ", { timeoutMs: 5_000, fetchImpl: fn });
    expect(out).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("HTTP 429 vira erro rate_limited (retryável)", async () => {
    const { fn } = fakeFetch(() => new Response("{}", { status: 429 }));
    await expect(searchMercadoLivre("teste", { timeoutMs: 5_000, fetchImpl: fn })).rejects.toMatchObject({
      code: "rate_limited",
      retryable: true,
    });
  });

  it("HTTP 403 cita o token e as permissões", async () => {
    const { fn } = fakeFetch(() => new Response("{}", { status: 403 }));
    await expect(searchMercadoLivre("teste", { timeoutMs: 5_000, fetchImpl: fn })).rejects.toMatchObject({ code: "unauthorized" });
  });
});

describe("teste de conexão com o Mercado Livre", () => {
  it("sem token: busca ok já valida a integração", async () => {
    const { fn } = fakeFetch(() => Response.json({ results: [{ id: "MLB1000000001", price: 1, currency_id: "BRL" }] }));
    const report = await testMercadoLivreConnection({ timeoutMs: 5_000, fetchImpl: fn, getAccessToken: () => undefined });
    expect(report.ok).toBe(true);
    expect(report.searchOk).toBe(true);
    expect(report.tokenPresent).toBe(false);
  });

  it("com token aceito: valida identidade sem expor o token", async () => {
    const { fn } = fakeFetch((url) => {
      if (url.includes("/users/me")) return Response.json({ nickname: "TESTE_USER", site_id: "MLB" });
      return Response.json({ results: [] });
    });
    const report = await testMercadoLivreConnection({ timeoutMs: 5_000, fetchImpl: fn, getAccessToken: () => "token-secreto" });
    expect(report.ok).toBe(true);
    expect(report.identity).toBe("TESTE_USER");
    expect(report.message).not.toContain("token-secreto");
  });

  it("busca falhando relata o motivo sem derrubar", async () => {
    const { fn } = fakeFetch(() => new Response("{}", { status: 500 }));
    const report = await testMercadoLivreConnection({ timeoutMs: 5_000, fetchImpl: fn });
    expect(report.ok).toBe(false);
    expect(report.message).toContain("500");
  });
});

describe("montagem da consulta de busca", () => {
  it("combina nome, marca, modelo e código, limitando tokens", () => {
    const q = buildSearchQuery({
      name: "Air Fryer Digital Grande Cinco Litros Preta Bonita Moderna",
      brand: "Exemplo",
      model: "AF-5000",
      manufacturerCode: "XPTO-99",
    });
    expect(q.split(" ").length).toBeLessThanOrEqual(10);
    expect(q.startsWith("air fryer") || q.startsWith("Air")).toBeTruthy();
  });

  it("produto sem dados extras usa apenas o nome", () => {
    expect(buildSearchQuery({ name: "Air fryer 5L", brand: null, model: null })).toBe("Air fryer 5L");
  });
});
