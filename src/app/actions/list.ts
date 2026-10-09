"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/db/client";
import { shoppingListItems, shoppingLists } from "@/db/schema";
import { formDataToObject } from "@/lib/validation/schemas";
import { fail, done, type ActionState } from "@/lib/action-state";
import { parseMoneyToCents } from "@/lib/money";
import { ROOMS } from "@/lib/constants";
import { getOrCreateList } from "@/lib/services/shopping-list";

const itemSchema = z.object({
  productId: z.string().uuid(),
  room: z.enum(ROOMS, { message: "Escolha um cômodo." }),
  quantity: z.coerce.number().int().min(1, "Quantidade mínima: 1").max(999),
});

function plannedFrom(raw: Record<string, string>): { ok: true; value: number | null } | { ok: false } {
  const v = (raw.plannedUnitBudgetCents ?? "").trim();
  if (v === "") return { ok: true, value: null };
  const cents = parseMoneyToCents(v);
  return cents === null ? { ok: false } : { ok: true, value: cents };
}

export async function addListItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const raw = formDataToObject(formData);
  const parsed = itemSchema.safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const planned = plannedFrom(raw);
  if (!planned.ok) return fail("Orçamento unitário inválido.");
  const db = getDb();
  const listId = await getOrCreateList(db);
  const existing = await db
    .select({ id: shoppingListItems.id })
    .from(shoppingListItems)
    .where(and(eq(shoppingListItems.listId, listId), eq(shoppingListItems.productId, parsed.data.productId)))
    .limit(1);
  if (existing[0]) return fail("Este produto já está na lista. Edite o item existente.");
  await db.insert(shoppingListItems).values({
    listId,
    productId: parsed.data.productId,
    room: parsed.data.room,
    quantity: parsed.data.quantity,
    plannedUnitBudgetCents: planned.value,
  });
  revalidatePath("/lista");
  return done("Item adicionado à lista.");
}

export async function updateListItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const raw = formDataToObject(formData);
  const id = z.string().uuid().safeParse(raw.id);
  if (!id.success) return fail("Item inválido.");
  const parsed = itemSchema.pick({ room: true, quantity: true }).safeParse(raw);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  const planned = plannedFrom(raw);
  if (!planned.ok) return fail("Orçamento unitário inválido.");
  await getDb()
    .update(shoppingListItems)
    .set({ room: parsed.data.room, quantity: parsed.data.quantity, plannedUnitBudgetCents: planned.value, updatedAt: new Date() })
    .where(eq(shoppingListItems.id, id.data));
  revalidatePath("/lista");
  return done("Item atualizado.");
}

export async function removeListItemAction(formData: FormData): Promise<void> {
  await requireUser();
  const id = z.string().uuid().safeParse(String(formData.get("id") ?? ""));
  if (!id.success) return;
  await getDb().delete(shoppingListItems).where(eq(shoppingListItems.id, id.data));
  revalidatePath("/lista");
}

export async function setListBudgetAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireUser();
  const raw = formDataToObject(formData);
  const v = (raw.totalBudgetCents ?? "").trim();
  const cents = v === "" ? null : parseMoneyToCents(v);
  if (v !== "" && cents === null) return fail("Orçamento inválido.", { totalBudgetCents: "Ex.: 15.000,00" });
  const db = getDb();
  const listId = await getOrCreateList(db);
  await db.update(shoppingLists).set({ totalBudgetCents: cents, updatedAt: new Date() }).where(eq(shoppingLists.id, listId));
  revalidatePath("/lista");
  return done("Orçamento atualizado.");
}
