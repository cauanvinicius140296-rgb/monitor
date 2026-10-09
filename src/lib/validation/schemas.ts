import { z } from "zod";
import { isValidGtin, normalizeGtin } from "../analysis/matching";
import { parseMoneyToCents } from "../money";
import { parseUserProductUrl, UnsafeUrlError } from "../security/url";
import { CATEGORIES, ROOMS } from "../constants";



const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use no máximo ${max} caracteres.`)
    .transform((v) => (v === "" ? null : v));

const money = (label: string) =>
  z
    .string()
    .trim()
    .transform((v, ctx) => {
      if (v === "") return null;
      const cents = parseMoneyToCents(v);
      if (cents === null) {
        ctx.addIssue({ code: "custom", message: `${label}: informe um valor válido, ex.: 1.299,90` });
        return z.NEVER;
      }
      return cents;
    });

const optionalUrl = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === "") return null;
    try {
      return parseUserProductUrl(v).toString();
    } catch (err) {
      ctx.addIssue({ code: "custom", message: err instanceof UnsafeUrlError ? err.message : "URL inválida." });
      return z.NEVER;
    }
  });

const optionalImageUrl = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === "") return null;
    try {
      const u = new URL(v);
      if (u.protocol !== "https:") throw new Error("não https");
      return u.toString();
    } catch {
      ctx.addIssue({ code: "custom", message: "A imagem deve ser um endereço HTTPS válido." });
      return z.NEVER;
    }
  });

const gtinField = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (v === "") return null;
    const digits = normalizeGtin(v);
    if (!digits) {
      ctx.addIssue({ code: "custom", message: "GTIN/EAN deve ter 8, 12, 13 ou 14 dígitos." });
      return z.NEVER;
    }
    if (!isValidGtin(digits)) {
      ctx.addIssue({ code: "custom", message: "GTIN/EAN com dígito verificador inválido." });
      return z.NEVER;
    }
    return digits;
  });

export const productFormSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do produto.").max(240),
  category: z.enum(CATEGORIES, { message: "Escolha uma categoria." }),
  subcategory: text(80),
  brand: text(120),
  model: text(160),
  manufacturerCode: text(120),
  gtin: gtinField,
  imageUrl: optionalImageUrl,
  referenceUrl: optionalUrl,
  targetPriceCents: money("Preço-alvo"),
  maxBudgetCents: money("Orçamento máximo"),
  referencePriceCents: money("Preço de referência"),
  notes: text(2000),
  priority: z.enum(["alta", "media", "baixa"]),
  status: z.enum(["monitorando", "comprado", "pausado", "arquivado"]),
});
export type ProductFormInput = z.infer<typeof productFormSchema>;

export const offerFormSchema = z.object({
  url: z
    .string()
    .trim()
    .transform((v, ctx) => {
      try {
        return parseUserProductUrl(v);
      } catch (err) {
        ctx.addIssue({ code: "custom", message: err instanceof UnsafeUrlError ? err.message : "URL inválida." });
        return z.NEVER;
      }
    }),
  priceCents: money("Preço"),
  shippingCents: money("Frete"),
  shippingKnown: z.boolean(),
  availability: z.enum(["disponivel", "indisponivel", "desconhecido"]),
});

export const listItemSchema = z.object({
  productId: z.string().uuid(),
  room: z.enum(ROOMS, { message: "Escolha um cômodo." }),
  quantity: z.coerce.number().int().min(1, "Quantidade mínima: 1").max(999),
  plannedUnitBudgetCents: money("Orçamento unitário"),
});

export const purchaseSchema = z.object({
  productId: z.string().uuid(),
  offerId: z.string().uuid().nullable(),
  quantity: z.coerce.number().int().min(1).max(999),
  paidUnitCents: money("Valor pago por unidade").transform((v) => v),
  paidShippingCents: money("Frete pago"),
  purchasedAt: z.string().trim().optional(),
  notes: text(1000),
});

export function formDataToObject(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  formData.forEach((value, key) => {
    if (typeof value === "string") out[key] = value;
  });
  return out;
}

export function zodFieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

export { isValidGtin };
