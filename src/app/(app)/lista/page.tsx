import Link from "next/link";
import { eq, inArray, asc } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/db/client";
import { purchases, shoppingListItems, shoppingLists } from "@/db/schema";
import { loadSettings } from "@/lib/repos/settings-repo";
import { loadCatalog } from "@/lib/repos/catalog";
import { getOrCreateList } from "@/lib/services/shopping-list";
import { summarizeShoppingList } from "@/lib/analysis/shopping";
import { ROOMS, STATUS_LABELS } from "@/lib/constants";
import { REFERENCE_LABELS } from "@/lib/analysis/references";
import { formatBRL } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { Badge, Card, CardTitle, EmptyState, PageHeader, StatCard } from "@/components/ui";
import { ListAddForm, ListBudgetForm, ListEditForm } from "@/components/forms";
import { removeListItemAction, addListItemAction, updateListItemAction, setListBudgetAction } from "@/app/actions/list";

export const dynamic = "force-dynamic";

export default async function ListaPage() {
  await requireUser();
  const now = new Date();
  const db = getDb();
  const settings = await loadSettings(db);
  const listId = await getOrCreateList(db);
  const [list] = await db.select().from(shoppingLists).where(eq(shoppingLists.id, listId)).limit(1);

  const items = await db
    .select()
    .from(shoppingListItems)
    .where(eq(shoppingListItems.listId, listId))
    .orderBy(asc(shoppingListItems.room), asc(shoppingListItems.createdAt));

  const productIds = items.map((i) => i.productId);
  const catalog = productIds.length
    ? await loadCatalog(db, { now, settings, filter: { productIds, includeArchived: true } })
    : [];
  const byId = new Map(catalog.map((p) => [p.id, p]));

  const linePurchases = productIds.length
    ? await db.select().from(purchases).where(inArray(purchases.productId, productIds))
    : [];

  const lines = items.map((item) => {
    const p = byId.get(item.productId);
    return {
      item,
      product: p,
      line: {
        quantity: item.quantity,
        status: (p?.status ?? "monitorando") as "monitorando" | "comprado" | "pausado" | "arquivado",
        plannedUnitBudgetCents: item.plannedUnitBudgetCents,
        maxBudgetCents: p?.maxBudgetCents ?? null,
        targetPriceCents: p?.targetPriceCents ?? null,
        bestComparableCents: p?.bestComparableCents ?? null,
        referenceCents: p?.referenceCents ?? null,
      },
    };
  });

  const summary = summarizeShoppingList(
    lines.map((l) => l.line),
    linePurchases.map((p) => ({
      quantity: p.quantity,
      paidUnitCents: p.paidUnitCents,
      paidShippingCents: p.paidShippingCents,
      realizedSavingCents: p.realizedSavingCents,
    })),
    list?.totalBudgetCents ?? null,
  );

  const productsForAdd = (await loadCatalog(db, { now, settings })).map((p) => ({ id: p.id, name: p.name }));

  const byRoom = new Map<string, typeof lines>();
  for (const l of lines) {
    const arr = byRoom.get(l.item.room) ?? [];
    arr.push(l);
    byRoom.set(l.item.room, arr);
  }

  return (
    <>
      <PageHeader
        title="Minha Lista de Compras"
        subtitle="Itens por cômodo, com orçamento planejado e comparação com os preços monitorados."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Orçamento total" value={formatBRL(list?.totalBudgetCents ?? summary.plannedBudgetCents)} hint={list?.totalBudgetCents ? "Informado por você" : "Soma do planejado (sem orçamento total)"} />
        <StatCard label="Soma no preço atual" value={formatBRL(summary.currentPricesCents)} hint={summary.itemsWithoutPrice ? `${summary.itemsWithoutPrice} item(ns) sem preço` : "Itens pendentes"} />
        <StatCard label="Economia potencial" value={formatBRL(summary.potentialSavingCents)} tone="info" hint={`Referência (${REFERENCE_LABELS[settings.referenceMode].toLowerCase()}) − preço atual. Não é economia realizada.`} />
        <StatCard label="Economia realizada" value={formatBRL(summary.realizedSavingCents)} tone="success" hint="Referência − valor pago, nas compras registradas" />
        <StatCard label="Total atingido" value={formatBRL(summary.reachedGoalsCents)} hint={`${summary.reachedGoalsCount} unidade(s) no preço-alvo ou orçamento`} tone="success" />
        <StatCard label="Comprados" value={String(summary.purchasedItemsCount)} hint={`Total pago: ${formatBRL(summary.purchasedTotalCents)}`} />
        <StatCard label="Orçamento restante" value={formatBRL(summary.remainingBudgetCents)} tone={summary.remainingBudgetCents < 0 ? "danger" : "default"} hint={`Projetado após pendentes: ${formatBRL(summary.projectedRemainingCents)}`} />
        <StatCard label="Sem orçamento definido" value={String(summary.itemsWithoutBudget)} hint="Itens sem orçamento unitário" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          {lines.length === 0 ? (
            <Card>
              <EmptyState title="Sua lista está vazia.">Adicione produtos cadastrados usando o formulário ao lado.</EmptyState>
            </Card>
          ) : (
            ROOMS.filter((r) => byRoom.has(r)).map((room) => (
              <Card key={room}>
                <CardTitle>{room}</CardTitle>
                <ul className="divide-y divide-slate-100">
                  {byRoom.get(room)!.map(({ item, product, line }) => {
                    const unitBudget = line.plannedUnitBudgetCents ?? line.maxBudgetCents ?? line.targetPriceCents;
                    const diff = line.bestComparableCents !== null && line.referenceCents !== null ? line.referenceCents - line.bestComparableCents : null;
                    return (
                      <li key={item.id} className="py-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <Link href={`/produtos/${item.productId}`} className="font-medium text-indigo-700 hover:underline">
                              {product?.name ?? "Produto indisponível"}
                            </Link>
                            <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
                              {product ? <Badge>{STATUS_LABELS[product.status]}</Badge> : null}
                              {product?.status === "comprado" ? <Badge tone="success">Comprado</Badge> : null}
                              <Badge>{item.quantity}×</Badge>
                              <Badge>Orçamento unit.: {unitBudget === null || unitBudget === undefined ? "não definido" : formatBRL(unitBudget)}</Badge>
                              {product?.bestComparableCents !== null && product?.bestComparableCents !== undefined ? (
                                <Badge tone={unitBudget !== null && unitBudget !== undefined && product.bestComparableCents <= unitBudget ? "success" : "neutral"}>
                                  Agora: {formatBRL(product.bestComparableCents)}
                                  {product.best ? ` em ${product.best.storeName}` : ""}
                                </Badge>
                              ) : (
                                <Badge tone="warning">Sem preço válido</Badge>
                              )}
                              {diff !== null && diff > 0 ? <Badge tone="info">Economia potencial: {formatBRL(diff)}</Badge> : null}
                              {product?.targetPriceCents !== null && product?.targetPriceCents !== undefined && product.bestComparableCents !== null && product.bestComparableCents <= product.targetPriceCents ? (
                                <Badge tone="success">Preço-alvo atingido</Badge>
                              ) : null}
                            </div>
                            {product ? (
                              <p className="mt-1 text-xs text-slate-500">
                                Subtotal agora: {line.bestComparableCents !== null ? formatBRL(line.bestComparableCents * item.quantity) : "—"}
                                {product.lastCollectedAt ? ` · última coleta ${formatDate(product.lastCollectedAt)}` : ""}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex flex-col items-start gap-2 sm:items-end">
                            <ListEditForm
                              id={item.id}
                              room={item.room}
                              quantity={item.quantity}
                              plannedUnitBudget={item.plannedUnitBudgetCents !== null ? (item.plannedUnitBudgetCents / 100).toFixed(2).replace(".", ",") : ""}
                              action={updateListItemAction}
                            />
                            <form action={removeListItemAction}>
                              <input type="hidden" name="id" value={item.id} />
                              <button type="submit" className="text-xs text-rose-700 hover:underline">Remover da lista</button>
                            </form>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            ))
          )}
        </div>

        <aside className="space-y-4">
          <Card>
            <CardTitle>Orçamento total</CardTitle>
            <ListBudgetForm defaultValue={list?.totalBudgetCents !== null && list?.totalBudgetCents !== undefined ? (list.totalBudgetCents / 100).toFixed(2).replace(".", ",") : ""} action={setListBudgetAction} />
            <p className="mt-2 text-xs text-slate-500">Se vazio, o orçamento usado é a soma dos orçamentos planejados.</p>
          </Card>
          <Card>
            <CardTitle>Adicionar à lista</CardTitle>
            {productsForAdd.length === 0 ? (
              <EmptyState title="Nenhum produto cadastrado.">
                <Link href="/produtos/novo" className="text-indigo-600 hover:underline">Cadastrar produto</Link>
              </EmptyState>
            ) : (
              <ListAddForm products={productsForAdd} action={addListItemAction} />
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}
