/**
 * Motor de alertas (função pura).
 *
 * Cada regra é uma condição booleana por produto. Um alerta só é CRIADO na transição
 * "falso -> verdadeiro". Enquanto a condição continuar verdadeira, nada é repetido.
 * Exceção: quedas/mínimos/oportunidades geram novo alerta quando o preço cai mais
 * `realertDropPercent`% abaixo do preço do último alerta (nova oportunidade relevante).
 */
import { percentDrop } from "../money";

export const ALERT_TYPES = [
  "preco_alvo",
  "orcamento",
  "queda_percentual",
  "menor_preco_observado",
  "oportunidade_outra_loja",
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export const ALERT_LABELS: Record<AlertType, string> = {
  preco_alvo: "Atingiu o preço-alvo",
  orcamento: "Abaixo do orçamento máximo",
  queda_percentual: "Queda de preço",
  menor_preco_observado: "Menor preço observado pelo sistema",
  oportunidade_outra_loja: "Oportunidade em outra loja",
};

/** Tipos que se re-disparam quando o preço cai ainda mais (novas oportunidades). */
const REALERTABLE: AlertType[] = ["queda_percentual", "menor_preco_observado", "oportunidade_outra_loja"];

export interface EvalOffer {
  offerId: string;
  storeId: string;
  storeName: string;
  url: string;
  priceCents: number | null;
  shippingCents: number | null;
  shippingKnown: boolean;
  availability: "disponivel" | "indisponivel" | "desconhecido";
  matchStatus: "confirmado" | "pendente" | "divergente";
  lastSuccessAt: Date | null;
  isActive: boolean;
}

export interface EvalPoint {
  priceCents: number;
  collectedAt: Date;
}

export interface EvalProduct {
  id: string;
  name: string;
  targetPriceCents: number | null;
  maxBudgetCents: number | null;
}

export interface EvalSettings {
  intervalHours: number;
  staleAfterIntervals: number;
  dropThresholdPercent: number;
  dropWindowDays: number;
  realertDropPercent: number;
  otherStoreThresholdPercent: number;
  enabledEvents: Record<AlertType, boolean>;
}

export interface EvalState {
  type: AlertType;
  isActive: boolean;
  lastAlertPriceCents: number | null;
}

export interface EvalInput {
  product: EvalProduct;
  offers: EvalOffer[];
  /** Observações VÁLIDAS anteriores à coleta atual (a coleta atual não entra aqui). */
  history: EvalPoint[];
  now: Date;
  settings: EvalSettings;
  states: EvalState[];
}

export interface Candidate {
  observedPriceCents: number;
  referencePriceCents: number | null;
  targetPriceCents: number | null;
  offerId: string | null;
  storeId: string | null;
  storeName: string | null;
  offerUrl: string | null;
  title: string;
  message: string;
}

export interface Decision {
  type: AlertType;
  /** Condição atual verdadeira? */
  active: boolean;
  /** Deve gerar um alerta nesta avaliação? */
  shouldAlert: boolean;
  /** Preço do último alerta após esta avaliação (para o re-alerta). */
  nextLastAlertPriceCents: number | null;
  /** Motivo quando a condição não pôde ser avaliada (ex.: histórico insuficiente). */
  skippedReason?: string;
  candidate?: Candidate;
}

const DAY_MS = 24 * 60 * 60 * 1000;

interface Comparable {
  offer: EvalOffer;
  comparableCents: number;
}

export function comparablePrice(offer: EvalOffer): number | null {
  if (offer.priceCents === null) return null;
  return offer.priceCents + (offer.shippingKnown && offer.shippingCents ? offer.shippingCents : 0);
}

/** Ofertas aptas a gerar alertas: dados atuais, confirmadas ou pendentes, não divergentes e recentes. */
export function eligibleOffers(offers: EvalOffer[], now: Date, settings: EvalSettings): Comparable[] {
  const maxAgeMs = settings.intervalHours * settings.staleAfterIntervals * 3_600_000;
  const out: Comparable[] = [];
  for (const offer of offers) {
    if (!offer.isActive) continue;
    if (offer.matchStatus === "divergente") continue;
    if (offer.availability === "indisponivel") continue;
    if (!offer.lastSuccessAt || now.getTime() - offer.lastSuccessAt.getTime() > maxAgeMs) continue;
    const c = comparablePrice(offer);
    if (c === null || c <= 0) continue;
    out.push({ offer, comparableCents: c });
  }
  return out;
}

function bestOf(list: Comparable[]): Comparable | null {
  if (list.length === 0) return null;
  return list.reduce((best, cur) => {
    if (cur.comparableCents < best.comparableCents) return cur;
    if (cur.comparableCents === best.comparableCents && cur.offer.shippingKnown && !best.offer.shippingKnown) return cur;
    return best;
  });
}

function shippingNote(offer: EvalOffer): string {
  return offer.shippingKnown ? "" : " (frete ainda desconhecido)";
}

function brl(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function evaluateAlerts(input: EvalInput): Decision[] {
  const { product, offers, history, now, settings, states } = input;
  const eligible = eligibleOffers(offers, now, settings);
  const best = bestOf(eligible);
  const stateOf = (t: AlertType) => states.find((s) => s.type === t);
  const decisions: Decision[] = [];

  const decide = (
    type: AlertType,
    active: boolean,
    candidate: Candidate | undefined,
    skippedReason?: string,
  ): void => {
    const prev = stateOf(type);
    const wasActive = prev?.isActive ?? false;
    let shouldAlert = false;
    let nextLast: number | null = null;

    if (active && candidate) {
      nextLast = prev?.lastAlertPriceCents ?? null;
      if (!wasActive) {
        shouldAlert = true;
      } else if (REALERTABLE.includes(type) && prev?.lastAlertPriceCents != null) {
        const threshold = prev.lastAlertPriceCents * (1 - settings.realertDropPercent / 100);
        if (candidate.observedPriceCents <= threshold) shouldAlert = true;
      }
      if (shouldAlert) nextLast = candidate.observedPriceCents;
      if (!settings.enabledEvents[type]) shouldAlert = false;
    }

    decisions.push({
      type,
      active,
      shouldAlert,
      nextLastAlertPriceCents: active ? nextLast : null,
      skippedReason,
      candidate: active ? candidate : undefined,
    });
  };

  // 1) Preço-alvo
  if (product.targetPriceCents && best) {
    const hit = best.comparableCents <= product.targetPriceCents;
    decide(
      "preco_alvo",
      hit,
      hit
        ? {
            observedPriceCents: best.comparableCents,
            referencePriceCents: null,
            targetPriceCents: product.targetPriceCents,
            offerId: best.offer.offerId,
            storeId: best.offer.storeId,
            storeName: best.offer.storeName,
            offerUrl: best.offer.url,
            title: `${product.name}: atingiu o preço-alvo`,
            message: `${brl(best.comparableCents)} na ${best.offer.storeName} (alvo: ${brl(product.targetPriceCents)})${shippingNote(best.offer)}.`,
          }
        : undefined,
    );
  } else {
    decide("preco_alvo", false, undefined, product.targetPriceCents ? "Sem oferta elegível" : "Preço-alvo não definido");
  }

  // 2) Orçamento máximo
  if (product.maxBudgetCents && best) {
    const hit = best.comparableCents <= product.maxBudgetCents;
    decide(
      "orcamento",
      hit,
      hit
        ? {
            observedPriceCents: best.comparableCents,
            referencePriceCents: null,
            targetPriceCents: product.maxBudgetCents,
            offerId: best.offer.offerId,
            storeId: best.offer.storeId,
            storeName: best.offer.storeName,
            offerUrl: best.offer.url,
            title: `${product.name}: abaixo do orçamento máximo`,
            message: `${brl(best.comparableCents)} na ${best.offer.storeName}, dentro do orçamento de ${brl(product.maxBudgetCents)}${shippingNote(best.offer)}.`,
          }
        : undefined,
    );
  } else {
    decide("orcamento", false, undefined, product.maxBudgetCents ? "Sem oferta elegível" : "Orçamento não definido");
  }

  // 3) Queda percentual frente ao maior preço da janela (somente histórico anterior)
  if (best) {
    const since = now.getTime() - settings.dropWindowDays * DAY_MS;
    const window = history.filter((p) => p.collectedAt.getTime() >= since);
    if (window.length < 2) {
      decide("queda_percentual", false, undefined, "Histórico insuficiente na janela");
    } else {
      const refMax = Math.max(...window.map((p) => p.priceCents));
      const drop = percentDrop(refMax, best.comparableCents) ?? 0;
      const hit = drop >= settings.dropThresholdPercent && refMax > best.comparableCents;
      decide(
        "queda_percentual",
        hit,
        hit
          ? {
              observedPriceCents: best.comparableCents,
              referencePriceCents: refMax,
              targetPriceCents: null,
              offerId: best.offer.offerId,
              storeId: best.offer.storeId,
              storeName: best.offer.storeName,
              offerUrl: best.offer.url,
              title: `${product.name}: queda de ${drop.toFixed(1).replace(".", ",")}%`,
              message: `De ${brl(refMax)} para ${brl(best.comparableCents)} na ${best.offer.storeName} nos últimos ${settings.dropWindowDays} dias${shippingNote(best.offer)}.`,
            }
          : undefined,
      );
    }
  } else {
    decide("queda_percentual", false, undefined, "Sem oferta elegível");
  }

  // 4) Menor preço observado pelo sistema (histórico anterior, mínimo de 2 observações)
  if (best) {
    if (history.length < 2) {
      decide("menor_preco_observado", false, undefined, "Histórico insuficiente");
    } else {
      const prevMin = Math.min(...history.map((p) => p.priceCents));
      const hit = best.comparableCents <= prevMin;
      const firstAt = [...history].sort((a, b) => a.collectedAt.getTime() - b.collectedAt.getTime())[0].collectedAt;
      decide(
        "menor_preco_observado",
        hit,
        hit
          ? {
              observedPriceCents: best.comparableCents,
              referencePriceCents: prevMin,
              targetPriceCents: null,
              offerId: best.offer.offerId,
              storeId: best.offer.storeId,
              storeName: best.offer.storeName,
              offerUrl: best.offer.url,
              title: `${product.name}: menor preço observado pelo sistema`,
              message: `${brl(best.comparableCents)} na ${best.offer.storeName}. Menor valor registrado pelo Radar desde ${firstAt.toLocaleDateString("pt-BR")} (não é necessariamente o menor do mercado)${shippingNote(best.offer)}.`,
            }
          : undefined,
      );
    }
  } else {
    decide("menor_preco_observado", false, undefined, "Sem oferta elegível");
  }

  // 5) Oportunidade em outra loja: a melhor oferta de uma loja fica X% abaixo da melhor de outra loja.
  const confirmed = eligible.filter((c) => c.offer.matchStatus === "confirmado");
  const cheapestByStore = new Map<string, Comparable>();
  for (const c of confirmed) {
    const cur = cheapestByStore.get(c.offer.storeId);
    if (!cur || c.comparableCents < cur.comparableCents) cheapestByStore.set(c.offer.storeId, c);
  }
  const ranked = [...cheapestByStore.values()].sort((a, b) => a.comparableCents - b.comparableCents);
  if (ranked.length < 2) {
    decide("oportunidade_outra_loja", false, undefined, "Menos de duas lojas com oferta confirmada");
  } else {
    const [first, second] = ranked;
    const gap = percentDrop(second.comparableCents, first.comparableCents) ?? 0;
    const hit = gap >= settings.otherStoreThresholdPercent;
    decide(
      "oportunidade_outra_loja",
      hit,
      hit
        ? {
            observedPriceCents: first.comparableCents,
            referencePriceCents: second.comparableCents,
            targetPriceCents: null,
            offerId: first.offer.offerId,
            storeId: first.offer.storeId,
            storeName: first.offer.storeName,
            offerUrl: first.offer.url,
            title: `${product.name}: oportunidade na ${first.offer.storeName}`,
            message: `${gap.toFixed(1).replace(".", ",")}% abaixo da segunda melhor oferta (${second.offer.storeName}, ${brl(second.comparableCents)}).`,
          }
        : undefined,
    );
  }

  return decisions;
}
