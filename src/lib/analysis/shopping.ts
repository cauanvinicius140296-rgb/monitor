/**
 * Totais da "Minha Lista de Compras" (função pura).
 *
 * Diferença importante:
 * - Economia POTENCIAL: referência - preço atual, para itens ainda não comprados.
 * - Economia REALIZADA: referência - valor efetivamente pago, em compras registradas.
 */
export interface ShoppingLine {
  quantity: number;
  status: "monitorando" | "comprado" | "pausado" | "arquivado";
  plannedUnitBudgetCents: number | null;
  maxBudgetCents: number | null;
  targetPriceCents: number | null;
  bestComparableCents: number | null;
  referenceCents: number | null;
}

export interface PurchaseLine {
  quantity: number;
  paidUnitCents: number;
  paidShippingCents: number;
  realizedSavingCents: number | null;
}

export interface ShoppingSummary {
  plannedBudgetCents: number;
  itemsWithoutBudget: number;
  currentPricesCents: number;
  itemsWithoutPrice: number;
  potentialSavingCents: number;
  reachedGoalsCents: number;
  reachedGoalsCount: number;
  purchasedItemsCount: number;
  purchasedTotalCents: number;
  realizedSavingCents: number;
  /** Orçamento total informado (ou planejado) - total pago. */
  remainingBudgetCents: number;
  /** Restante projetado se os itens pendentes forem comprados aos preços atuais. */
  projectedRemainingCents: number;
}

export function summarizeShoppingList(
  lines: ShoppingLine[],
  purchases: PurchaseLine[],
  totalBudgetCents: number | null,
): ShoppingSummary {
  let plannedBudgetCents = 0;
  let itemsWithoutBudget = 0;
  let currentPricesCents = 0;
  let itemsWithoutPrice = 0;
  let potentialSavingCents = 0;
  let reachedGoalsCents = 0;
  let reachedGoalsCount = 0;
  let purchasedItemsCount = 0;
  let pendingCurrentCents = 0;

  for (const line of lines) {
    if (line.status === "comprado") {
      purchasedItemsCount += line.quantity;
      continue;
    }
    const unitBudget = line.plannedUnitBudgetCents ?? line.maxBudgetCents ?? line.targetPriceCents;
    if (unitBudget === null) itemsWithoutBudget++;
    else plannedBudgetCents += unitBudget * line.quantity;

    if (line.bestComparableCents === null) {
      itemsWithoutPrice++;
      continue;
    }
    const lineCurrent = line.bestComparableCents * line.quantity;
    currentPricesCents += lineCurrent;
    pendingCurrentCents += lineCurrent;

    if (line.referenceCents !== null && line.referenceCents > line.bestComparableCents) {
      potentialSavingCents += (line.referenceCents - line.bestComparableCents) * line.quantity;
    }
    const goal = line.targetPriceCents ?? line.maxBudgetCents;
    if (goal !== null && line.bestComparableCents <= goal) {
      reachedGoalsCents += lineCurrent;
      reachedGoalsCount += line.quantity;
    }
  }

  let purchasedTotalCents = 0;
  let realizedSavingCents = 0;
  for (const p of purchases) {
    purchasedTotalCents += p.paidUnitCents * p.quantity + p.paidShippingCents;
    if (p.realizedSavingCents !== null) realizedSavingCents += p.realizedSavingCents;
  }

  const budget = totalBudgetCents ?? plannedBudgetCents;
  const remainingBudgetCents = budget - purchasedTotalCents;
  return {
    plannedBudgetCents,
    itemsWithoutBudget,
    currentPricesCents,
    itemsWithoutPrice,
    potentialSavingCents,
    reachedGoalsCents,
    reachedGoalsCount,
    purchasedItemsCount,
    purchasedTotalCents,
    realizedSavingCents,
    remainingBudgetCents,
    projectedRemainingCents: remainingBudgetCents - pendingCurrentCents,
  };
}
