import { beforeEach, describe, expect, it } from "vitest";
import { getDb, resetData, productInput } from "./helpers";
import { insertProduct } from "@/lib/services/products";
import { addOffer } from "@/lib/services/offers";
import { searchOffersForProduct } from "@/lib/services/search-offers";

const NOW = new Date();

beforeEach(async () => {
  await resetData();
});

function searchFetch(payload: unknown) {
  const calls: string[] = [];
  const fn = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return Response.json(payload);
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const PAYLOAD = {
  results: [
    {
      id: "MLB9000000001",
      title: "Air fryer 5L Exemplo AF-5000 Preta",
      price: 289.9,
      currency_id: "BRL",
      permalink: "https://produto.mercadolivre.com.br/MLB-9000000001-air-fryer-_JM",
      thumbnail: "https://http2.mlstatic.com/t1.jpg",
      shipping: { free_shipping: true },
      seller: { nickname: "VENDEDOR_1" },
    },
    {
      id: "MLB9000000002",
      title: "Air fryer 5L Exemplo AF-5000 Inox 220v",
      price: 309.0,
      currency_id: "BRL",
      permalink: "https://produto.mercadolivre.com.br/MLB-9000000002-air-fryer-_JM",
      thumbnail: "https://http2.mlstatic.com/t2.jpg",
      shipping: { free_shipping: false },
    },
  ],
};

describe("busca de ofertas correspondentes no Mercado Livre", () => {
  it("encontra candidatos, avalia correspondência e marca anúncios já cadastrados", async () => {
    const db = getDb();
    const productId = await insertProduct(db, productInput());

    // Oferta já cadastrada no Mercado Livre (mesmo anúncio do 1º resultado).
    const permalink = "https://produto.mercadolivre.com.br/MLB-9000000001-air-fryer-_JM";
    await addOffer(db, {
      productId,
      rawUrl: permalink,
      identified: {
        title: "Air fryer 5L Exemplo AF-5000 Preta",
        imageUrl: null,
        priceCents: 28_990,
        shippingCents: 0,
        shippingKnown: true,
        availability: "disponivel",
        brand: null,
        model: null,
        gtin: null,
        manufacturerCode: null,
        sellerName: null,
        externalId: "MLB9000000001",
        canonicalUrl: permalink,
      },
      now: NOW,
    });

    const { fn, calls } = searchFetch(PAYLOAD);
    const result = await searchOffersForProduct(db, { productId, fetchImpl: fn });

    expect(calls[0]).toContain("sites/MLB/search");
    expect(result.query).toContain("Air fryer");
    expect(result.candidates).toHaveLength(2);

    const existing = result.candidates.find((c) => c.externalId === "MLB9000000001")!;
    expect(existing.alreadyAdded).toBe(true);

    const fresh = result.candidates.find((c) => c.externalId === "MLB9000000002")!;
    expect(fresh.alreadyAdded).toBe(false);
    // Apenas o título está disponível na busca: exige revisão manual.
    expect(fresh.match.status).toBe("pendente");
    expect(fresh.permalink).toBe("https://produto.mercadolivre.com.br/MLB-9000000002-air-fryer-_JM");
  });

  it("falha da API vira erro controlado (SourceError)", async () => {
    const db = getDb();
    const productId = await insertProduct(db, productInput());
    const fn = (async () => new Response("{}", { status: 429 })) as unknown as typeof fetch;
    await expect(searchOffersForProduct(db, { productId, fetchImpl: fn })).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("produto inexistente gera erro claro", async () => {
    const db = getDb();
    await expect(
      searchOffersForProduct(db, { productId: "00000000-0000-4000-8000-000000000000", fetchImpl: searchFetch(PAYLOAD).fn }),
    ).rejects.toThrow("Produto não encontrado.");
  });
});
