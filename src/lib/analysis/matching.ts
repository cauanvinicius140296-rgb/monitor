/**
 * Correspondência entre um anúncio e o produto cadastrado.
 *
 * Regras:
 * - Nomes semelhantes NUNCA confirmam correspondência sozinhos.
 * - GTIN igual confirma; GTIN diferente diverge.
 * - Código do fabricante/modelo igual confirma, desde que não haja conflito de variante
 *   (capacidade, voltagem, cor, tamanho).
 * - Sem identificadores confiáveis: "pendente" (confirmação manual).
 */

export type MatchStatus = "confirmado" | "pendente" | "divergente";

export interface MatchIdentity {
  name?: string | null;
  brand?: string | null;
  model?: string | null;
  manufacturerCode?: string | null;
  gtin?: string | null;
}

export interface MatchResult {
  status: MatchStatus;
  reasons: string[];
}

export function normalizeText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeCode(value: string | null | undefined): string {
  if (!value) return "";
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function normalizeGtin(value: string | null | undefined): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  return [8, 12, 13, 14].includes(digits.length) ? digits : "";
}

/** Valida dígito verificador GTIN (módulo 10). */
export function isValidGtin(value: string): boolean {
  const digits = normalizeGtin(value);
  if (!digits) return false;
  const body = digits.slice(0, -1).split("").map(Number);
  const check = Number(digits.slice(-1));
  let sum = 0;
  // Posições contadas a partir da direita, excluindo o dígito verificador.
  for (let i = body.length - 1, pos = 1; i >= 0; i--, pos++) {
    sum += body[i] * (pos % 2 === 1 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === check;
}

export interface VariantTokens {
  capacity: string[];
  voltage: string[];
  color: string[];
  size: string[];
}

/** Cores reconhecidas, já no masculino singular (forma canônica). */
const COLOR_CANON: Record<string, string> = {
  branco: "branco", branca: "branco",
  preto: "preto", preta: "preto",
  cinza: "cinza",
  inox: "inox", inoxidavel: "inox",
  prata: "prata", prateado: "prata", prateada: "prata",
  azul: "azul",
  vermelho: "vermelho", vermelha: "vermelho",
  verde: "verde",
  rosa: "rosa",
  dourado: "dourado", dourada: "dourado",
  bege: "bege",
  amarelo: "amarelo", amarela: "amarelo",
  laranja: "laranja",
  roxo: "roxo", roxa: "roxo",
  marrom: "marrom",
  grafite: "grafite",
  champagne: "champagne",
  madeira: "madeira",
};

/** Extrai atributos de variante de um texto (capacidade, voltagem, cor, tamanho). */
export function extractVariantTokens(text: string | null | undefined): VariantTokens {
  const t = normalizeText(text);
  const capacity = new Set<string>();
  const size = new Set<string>();
  const voltage = new Set<string>();
  const color = new Set<string>();

  for (const m of t.matchAll(/\b(\d+(?:[.,]\d+)?)\s?(gb|tb|mb|litros|litro|l|ml|kg|g|btu|w|kw|polegadas|pol|cm|mm|m)\b/g)) {
    const unit = m[2];
    const value = m[1].replace(",", ".");
    if (["gb", "tb", "mb"].includes(unit)) capacity.add(`${value}${unit}`);
    else if (["litros", "litro", "l", "ml"].includes(unit)) capacity.add(`${value}${unit === "litros" || unit === "litro" ? "l" : unit}`);
    else if (["btu", "w", "kw"].includes(unit)) size.add(`${value}${unit}`);
    else if (["polegadas", "pol"].includes(unit)) size.add(`${value}pol`);
    else size.add(`${value}${unit}`);
  }
  for (const m of t.matchAll(/\b(110|127|220|380)\s?v\b/g)) voltage.add(`${m[1]}v`);
  if (/\bbivolt\b/.test(t)) voltage.add("bivolt");
  for (const word of t.split(" ")) {
    const canon = COLOR_CANON[word];
    if (canon) color.add(canon);
  }
  return {
    capacity: [...capacity].sort(),
    voltage: [...voltage].sort(),
    color: [...color].sort(),
    size: [...size].sort(),
  };
}

/** Lista de conflitos de variante: categorias presentes em ambos os lados e diferentes. */
export function variantConflicts(a: VariantTokens, b: VariantTokens): string[] {
  const conflicts: string[] = [];
  const labels: Record<keyof VariantTokens, string> = {
    capacity: "capacidade",
    voltage: "voltagem",
    color: "cor",
    size: "tamanho",
  };
  (Object.keys(labels) as (keyof VariantTokens)[]).forEach((key) => {
    const x = a[key];
    const y = b[key];
    if (x.length > 0 && y.length > 0 && x.join("|") !== y.join("|")) {
      conflicts.push(`${labels[key]} diferente (${x.join(", ")} x ${y.join(", ")})`);
    }
  });
  return conflicts;
}

export function matchListing(product: MatchIdentity, listing: MatchIdentity & { title?: string | null }): MatchResult {
  const reasons: string[] = [];

  const gA = normalizeGtin(product.gtin);
  const gB = normalizeGtin(listing.gtin);
  if (gA && gB) {
    if (gA === gB) {
      return { status: "confirmado", reasons: ["GTIN/EAN idêntico"] };
    }
    return { status: "divergente", reasons: ["GTIN/EAN diferente: são produtos distintos"] };
  }

  const codeA = normalizeCode(product.manufacturerCode);
  const codeB = normalizeCode(listing.manufacturerCode);
  const modelA = normalizeCode(product.model);
  const modelB = normalizeCode(listing.model);
  const sameCode = codeA && codeB && codeA === codeB;
  const sameModel = modelA && modelB && modelA === modelB;

  if (sameCode || sameModel) {
    const variantsProduct = extractVariantTokens(`${product.name ?? ""} ${product.model ?? ""}`);
    const variantsListing = extractVariantTokens(`${listing.title ?? ""} ${listing.model ?? ""}`);
    const conflicts = variantConflicts(variantsProduct, variantsListing);
    if (conflicts.length > 0) {
      return { status: "divergente", reasons: [`Mesmo código, mas ${conflicts.join("; ")}`] };
    }
    const brandA = normalizeText(product.brand);
    const brandB = normalizeText(listing.brand);
    if (brandA && brandB && brandA !== brandB) {
      return { status: "divergente", reasons: ["Marcas diferentes"] };
    }
    reasons.push(sameCode ? "Código do fabricante igual" : "Modelo igual");
    return { status: "confirmado", reasons };
  }

  if (codeA && codeB && !sameCode) reasons.push("Códigos do fabricante diferentes");
  if (modelA && modelB && !sameModel) reasons.push("Modelos diferentes");
  if (reasons.length === 0) reasons.push("Sem identificadores comparáveis (GTIN, código ou modelo)");
  reasons.push("Confirmação manual necessária");
  return { status: reasons.some((r) => r.includes("diferentes")) ? "divergente" : "pendente", reasons };
}

export interface DuplicateCandidate {
  id: string;
  name: string;
  reason: string;
}

/** Encontra produtos cadastrados que podem ser duplicatas do novo cadastro (sem fundir automaticamente). */
export function findDuplicateCandidates(
  candidate: MatchIdentity,
  existing: (MatchIdentity & { id: string; name: string })[],
): DuplicateCandidate[] {
  const out: DuplicateCandidate[] = [];
  const gtin = normalizeGtin(candidate.gtin);
  const code = normalizeCode(candidate.manufacturerCode);
  const brand = normalizeText(candidate.brand);
  const model = normalizeCode(candidate.model);
  for (const p of existing) {
    if (gtin && normalizeGtin(p.gtin) === gtin) {
      out.push({ id: p.id, name: p.name, reason: "Mesmo GTIN/EAN" });
      continue;
    }
    if (code && normalizeCode(p.manufacturerCode) === code) {
      out.push({ id: p.id, name: p.name, reason: "Mesmo código do fabricante" });
      continue;
    }
    if (brand && model && normalizeText(p.brand) === brand && normalizeCode(p.model) === model) {
      out.push({ id: p.id, name: p.name, reason: "Mesma marca e modelo" });
    }
  }
  return out;
}
