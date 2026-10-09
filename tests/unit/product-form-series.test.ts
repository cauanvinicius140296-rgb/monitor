import { describe, expect, it } from "vitest";
import { productFormSchema } from "@/lib/validation/schemas";
import { centsToInput } from "@/lib/money";

const valid = {
  name: "Air fryer 5L",
  category: "Eletrodomésticos",
  subcategory: "",
  brand: "Exemplo",
  model: "AF-5000",
  manufacturerCode: "",
  gtin: "",
  imageUrl: "",
  referenceUrl: "",
  targetPriceCents: "",
  maxBudgetCents: "",
  referencePriceCents: "",
  notes: "",
  priority: "alta",
  status: "monitorando",
};

describe("validação do cadastro de produtos (servidor)", () => {
  it("aceita dados mínimos e converte preços para centavos", () => {
    const r = productFormSchema.safeParse({ ...valid, targetPriceCents: "299,90" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.targetPriceCents).toBe(29_990);
  });

  it("rejeita nome muito curto, categoria inválida e GTIN com dígito errado", () => {
    expect(productFormSchema.safeParse({ ...valid, name: "A" }).success).toBe(false);
    expect(productFormSchema.safeParse({ ...valid, category: "Inventada" }).success).toBe(false);
    expect(productFormSchema.safeParse({ ...valid, gtin: "7891234567890" }).success).toBe(false);
  });

  it("rejeita URL de referência não HTTPS ou interna", () => {
    expect(productFormSchema.safeParse({ ...valid, referenceUrl: "http://exemplo.com.br" }).success).toBe(false);
    expect(productFormSchema.safeParse({ ...valid, referenceUrl: "https://192.168.0.1/x" }).success).toBe(false);
  });

  it("centsToInput devolve texto brasileiro", () => {
    expect(centsToInput(129_990)).toBe("1299,90");
    expect(centsToInput(null)).toBe("");
  });
});
