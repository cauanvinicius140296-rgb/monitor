/**
 * Indicador de confiança da oferta. Não classifica fraude: apenas aponta
 * o que os dados disponíveis permitem afirmar e o que falta verificar.
 */

export type ConfidenceLevel = "alta" | "media" | "baixa";

export interface ConfidenceInput {
  source: "api" | "manual" | "demo";
  priceCents: number | null;
  shippingKnown: boolean;
  matchStatus: "confirmado" | "pendente" | "divergente";
  lastSuccessAt: Date | null;
  now: Date;
  intervalHours: number;
  staleAfterIntervals: number;
  validHistoryCount: number;
  availability: "disponivel" | "indisponivel" | "desconhecido";
  consecutiveFailures: number;
  /** Mediana dos preços válidos do período (para detectar quedas expressivas). */
  medianPriceCents?: number | null;
}

export interface ConfidenceResult {
  level: ConfidenceLevel;
  score: number;
  reasons: string[];
}

export function scoreOfferConfidence(input: ConfidenceInput): ConfidenceResult {
  const reasons: string[] = [];
  if (input.priceCents === null || input.priceCents <= 0) {
    return { level: "baixa", score: 0, reasons: ["Sem preço válido registrado"] };
  }

  let score = 50;

  if (input.source === "api") {
    score += 20;
    reasons.push("Dados vindos da API oficial da loja");
  } else if (input.source === "manual") {
    score += 5;
    reasons.push("Preço informado manualmente");
  } else {
    reasons.push("Dados de demonstração (não são preços reais)");
  }

  const staleHours = input.intervalHours * input.staleAfterIntervals;
  if (!input.lastSuccessAt) {
    score -= 25;
    reasons.push("Nunca coletado com sucesso");
  } else {
    const ageHours = (input.now.getTime() - input.lastSuccessAt.getTime()) / 3_600_000;
    if (ageHours > staleHours) {
      score -= 20;
      reasons.push(`Preço desatualizado (última coleta há ${Math.floor(ageHours)} h)`);
    } else {
      score += 10;
      reasons.push("Preço coletado dentro do intervalo esperado");
    }
  }

  if (input.matchStatus === "confirmado") {
    score += 15;
    reasons.push("Anúncio confirmado como o mesmo produto");
  } else if (input.matchStatus === "pendente") {
    score -= 10;
    reasons.push("Correspondência do anúncio ainda não confirmada");
  } else {
    score -= 30;
    reasons.push("Anúncio divergente do produto cadastrado");
  }

  if (input.shippingKnown) {
    score += 10;
    reasons.push("Frete conhecido");
  } else {
    score -= 5;
    reasons.push("Frete ainda desconhecido");
  }

  if (input.validHistoryCount >= 3) {
    score += 10;
  } else {
    score -= 5;
    reasons.push(`Histórico insuficiente (${input.validHistoryCount} observação(ões) válida(s))`);
  }

  if (input.availability === "disponivel") {
    score += 5;
  } else if (input.availability === "indisponivel") {
    score -= 20;
    reasons.push("Oferta indisponível");
  } else {
    score -= 10;
    reasons.push("Disponibilidade desconhecida");
  }

  if (input.consecutiveFailures >= 3) {
    score -= 15;
    reasons.push(`${input.consecutiveFailures} falhas seguidas na coleta`);
  }

  let sharpDrop = false;
  if (input.medianPriceCents && input.medianPriceCents > 0 && input.priceCents <= input.medianPriceCents * 0.6) {
    score -= 10;
    sharpDrop = true;
    reasons.push("Queda expressiva em relação ao histórico: confirme o preço antes de comprar");
  }

  score = Math.max(0, Math.min(100, score));
  let level: ConfidenceLevel = score >= 70 ? "alta" : score >= 45 ? "media" : "baixa";
  // Queda expressiva nunca aparece como confiança "alta" sem confirmação manual (não é classificação de fraude).
  if (sharpDrop && level === "alta") level = "media";
  return { level, score, reasons };
}

export const CONFIDENCE_LABEL: Record<ConfidenceLevel, string> = {
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
};
