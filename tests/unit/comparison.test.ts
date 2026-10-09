import { describe, expect, it } from "vitest";
import { sortOffersForComparison, type ComparableOffer } from "@/lib/analysis/comparison";

function offer(over: Partial<ComparableOffer> & { storeName: string }): ComparableOffer {
  return {
    comparableCents: null,
    availability: "disponivel",
    matchStatus: "pendente",
    isActive: true,
    ...over,
  };
}

describe("ordenação de ofertas para comparação", () => {
  it("coloca o menor preço total primeiro", () => {
    const out = sortOffersForComparison([
      offer({ storeName: "Loja B", comparableCents: 35_000 }),
      offer({ storeName: "Loja A", comparableCents: 29_990 }),
      offer({ storeName: "Loja C", comparableCents: 32_500 }),
    ]);
    expect(out.map((o) => o.storeName)).toEqual(["Loja A", "Loja C", "Loja B"]);
  });

  it("ofertas sem preço conhecido vêm depois das precificadas, em ordem alfabética", () => {
    const out = sortOffersForComparison([
      offer({ storeName: "Zeta" }),
      offer({ storeName: "Alfa", comparableCents: 10_000 }),
      offer({ storeName: "Beta" }),
    ]);
    expect(out.map((o) => o.storeName)).toEqual(["Alfa", "Beta", "Zeta"]);
  });

  it("empatadas no total desempata pelo nome da loja", () => {
    const out = sortOffersForComparison([
      offer({ storeName: "Loja B", comparableCents: 10_000 }),
      offer({ storeName: "Loja A", comparableCents: 10_000 }),
    ]);
    expect(out.map((o) => o.storeName)).toEqual(["Loja A", "Loja B"]);
  });

  it("divergentes ficam após as demais ativas; desativadas sempre por último", () => {
    const out = sortOffersForComparison([
      offer({ storeName: "Desativada barata", comparableCents: 100, isActive: false }),
      offer({ storeName: "Divergente", comparableCents: 200, matchStatus: "divergente" }),
      offer({ storeName: "Sem preço" }),
      offer({ storeName: "Normal", comparableCents: 500 }),
    ]);
    expect(out.map((o) => o.storeName)).toEqual(["Normal", "Sem preço", "Divergente", "Desativada barata"]);
  });

  it("não altera o array de entrada", () => {
    const input = [offer({ storeName: "B", comparableCents: 2 }), offer({ storeName: "A", comparableCents: 1 })];
    const out = sortOffersForComparison(input);
    expect(input[0].storeName).toBe("B");
    expect(out).not.toBe(input);
  });
});
