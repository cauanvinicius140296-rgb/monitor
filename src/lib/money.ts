/**
 * Utilidades monetárias. Todos os valores internos são inteiros em centavos.
 */

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Converte centavos em texto brasileiro para campos de dinheiro ("1299,90"). Usável em servidor e cliente. */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}

export function formatBRL(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return brl.format(cents / 100);
}

/**
 * Converte entrada digitada em reais para centavos.
 * Aceita "1.299,90", "1299,9", "1299.90", "R$ 1.299", "1299".
 * Retorna null para entradas vazias ou inválidas.
 */
export function parseMoneyToCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) return null;
    return Math.round(input * 100);
  }
  let s = input.replace(/R\$/gi, "").replace(/\s/g, "").trim();
  if (s === "") return null;
  if (s.includes(",")) {
    // Formato brasileiro: ponto separa milhar, vírgula separa decimal.
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    // "1.299" ou "12.345.678": separadores de milhar.
    s = s.replace(/\./g, "");
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const value = Number(s);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/** Variação percentual de `from` para `to`. Retorna null se `from` não for positivo. */
export function percentChange(from: number | null | undefined, to: number | null | undefined): number | null {
  if (from === null || from === undefined || to === null || to === undefined) return null;
  if (from <= 0) return null;
  return ((to - from) / from) * 100;
}

/** Queda percentual em relação a uma referência (positivo = preço caiu). */
export function percentDrop(reference: number | null | undefined, current: number | null | undefined): number | null {
  const change = percentChange(reference, current);
  return change === null ? null : -change;
}

export function roundPercent(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.round(value * 10) / 10;
}

export function formatPercent(value: number | null | undefined, signed = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const rounded = roundPercent(value) ?? 0;
  const prefix = signed && rounded > 0 ? "+" : "";
  return `${prefix}${rounded.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}
