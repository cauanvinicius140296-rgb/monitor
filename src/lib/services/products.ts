import { and, eq, ne } from "drizzle-orm";
import type { Db } from "@/db/client";
import { products } from "@/db/schema";
import { findDuplicateCandidates, type DuplicateCandidate } from "../analysis/matching";
import type { ProductFormInput } from "../validation/schemas";

export interface ProductWriteInput extends ProductFormInput {}

export async function findProductDuplicates(
  db: Db,
  input: Pick<ProductWriteInput, "gtin" | "manufacturerCode" | "brand" | "model">,
  excludeId?: string,
): Promise<DuplicateCandidate[]> {
  const existing = await db
    .select({
      id: products.id,
      name: products.name,
      gtin: products.gtin,
      manufacturerCode: products.manufacturerCode,
      brand: products.brand,
      model: products.model,
    })
    .from(products)
    .where(excludeId ? and(ne(products.id, excludeId), ne(products.status, "arquivado")) : ne(products.status, "arquivado"));
  return findDuplicateCandidates(
    { gtin: input.gtin, manufacturerCode: input.manufacturerCode, brand: input.brand, model: input.model },
    existing,
  );
}

function toRow(input: ProductWriteInput) {
  return {
    name: input.name,
    category: input.category,
    subcategory: input.subcategory,
    brand: input.brand,
    model: input.model,
    manufacturerCode: input.manufacturerCode,
    gtin: input.gtin,
    imageUrl: input.imageUrl,
    referenceUrl: input.referenceUrl,
    targetPriceCents: input.targetPriceCents,
    maxBudgetCents: input.maxBudgetCents,
    referencePriceCents: input.referencePriceCents,
    notes: input.notes,
    priority: input.priority,
    status: input.status,
    updatedAt: new Date(),
  };
}

export async function insertProduct(db: Db, input: ProductWriteInput): Promise<string> {
  const [row] = await db.insert(products).values(toRow(input)).returning({ id: products.id });
  return row.id;
}

export async function updateProductRow(db: Db, id: string, input: ProductWriteInput): Promise<void> {
  await db.update(products).set(toRow(input)).where(eq(products.id, id));
}

export async function setProductStatus(db: Db, id: string, status: ProductWriteInput["status"]): Promise<void> {
  await db.update(products).set({ status, updatedAt: new Date() }).where(eq(products.id, id));
}
