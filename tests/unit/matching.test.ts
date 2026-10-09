import { describe, expect, it } from "vitest";
import { matchListing, isValidGtin, extractVariantTokens, variantConflicts } from "@/lib/analysis/matching";

describe("matching de anúncios", () => {
  it("GTIN idêntico confirma o produto", () => {
    const r = matchListing({ gtin: "7891234567895" }, { gtin: "7891234567895" });
    expect(r.status).toBe("confirmado");
  });

  it("GTIN diferente marca divergência, mesmo com o mesmo nome", () => {
    const r = matchListing({ name: "Air fryer 5L", gtin: "7891234567895" }, { name: "Air fryer 5L", gtin: "7891234567906" });
    expect(r.status).toBe("divergente");
  });

  it("nunca confirma apenas pelo nome semelhante", () => {
    const r = matchListing({ name: "Liquidificador Oster 1000W" }, { title: "Liquidificador Oster 1000W", name: "Liquidificador Oster 1000W" });
    expect(r.status).not.toBe("confirmado");
  });

  it("sem identificadores fica pendente", () => {
    expect(matchListing({ name: "Cafeteira" }, { name: "Cafeteira" }).status).toBe("pendente");
  });

  it("código/modelo igual sem conflito de variantes confirma", () => {
    const r = matchListing({ model: "AF-5000", brand: "Philco" }, { model: "AF-5000", brand: "Philco" });
    expect(r.status).toBe("confirmado");
  });

  it("capacidade diferente é conflito de variante", () => {
    const a = extractVariantTokens("Geladeira Brastemp 400L branca 127V");
    const b = extractVariantTokens("Geladeira Brastemp 500L branca 127V");
    expect(variantConflicts(a, b).length).toBeGreaterThan(0);
  });

  it("voltagem diferente impede confirmação por modelo", () => {
    const r = matchListing(
      { model: "AF-5000", name: "Air fryer AF-5000 127V" },
      { model: "AF-5000", title: "Air fryer AF-5000 220V" },
    );
    expect(r.status).not.toBe("confirmado");
  });

  it("valida dígito verificador do GTIN", () => {
    expect(isValidGtin("7891234567895")).toBe(true);
    expect(isValidGtin("7891234567890")).toBe(false);
    expect(isValidGtin("123")).toBe(false);
  });
});
