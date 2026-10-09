import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { purchases, shoppingListItems, shoppingLists } from "@/db/schema";

export async function getOrCreateList(db: Db): Promise<string> {
  const rows = await db.select({ id: shoppingLists.id }).from(shoppingLists).limit(1);
  if (rows[0]) return rows[0].id;
  const [created] = await db.insert(shoppingLists).values({}).returning({ id: shoppingLists.id });
  return created.id;
}

export async function listItemsWithPurchases(db: Db, listId: string) {
  const items = await db.select().from(shoppingListItems).where(eq(shoppingListItems.listId, listId));
  const productIds = [...new Set(items.map((i) => i.productId))];
  // Só as compras dos produtos desta lista (compras de outros produtos não entram na conta).
  const listPurchases =
    productIds.length === 0 ? [] : await db.select().from(purchases).where(inArray(purchases.productId, productIds));
  return { items, purchases: listPurchases };
}
