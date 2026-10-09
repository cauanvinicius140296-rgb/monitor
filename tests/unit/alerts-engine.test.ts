import { describe, expect, it } from "vitest";
import { ALERT_TYPES, evaluateAlerts, type EvalInput, type EvalOffer } from "@/lib/analysis/alerts-engine";

const NOW = new Date("2026-10-09T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const enabled = Object.fromEntries(ALERT_TYPES.map((t) => [t, true])) as Record<(typeof ALERT_TYPES)[number], boolean>;

function offer(over: Partial<EvalOffer> = {}): EvalOffer {
  return {
    offerId: "o1",
    storeId: "s1",
    storeName: "Loja A",
    url: "https://loja-a.example/p/1",
    priceCents: 29_000,
    shippingCents: 0,
    shippingKnown: true,
    availability: "disponivel",
    matchStatus: "confirmado",
    lastSuccessAt: hoursAgo(1),
    isActive: true,
    ...over,
  };
}

function input(over: Partial<EvalInput> = {}): EvalInput {
  return {
    product: { id: "p1", name: "Air fryer", targetPriceCents: 30_000, maxBudgetCents: null },
    offers: [offer()],
    history: [
      { priceCents: 40_000, collectedAt: hoursAgo(72) },
      { priceCents: 40_000, collectedAt: hoursAgo(48) },
      { priceCents: 39_000, collectedAt: hoursAgo(24) },
    ],
    now: NOW,
    settings: {
      intervalHours: 6,
      staleAfterIntervals: 2,
      dropThresholdPercent: 10,
      dropWindowDays: 7,
      realertDropPercent: 5,
      otherStoreThresholdPercent: 5,
      enabledEvents: enabled,
    },
    states: [],
    ...over,
  };
}

const decisionOf = (decisions: ReturnType<typeof evaluateAlerts>, type: string) => decisions.find((d) => d.type === type)!;

describe("motor de alertas", () => {
  it("cria alerta de preço-alvo na primeira vez em que a condição fica verdadeira", () => {
    const d = decisionOf(evaluateAlerts(input()), "preco_alvo");
    expect(d.active).toBe(true);
    expect(d.shouldAlert).toBe(true);
    expect(d.candidate?.observedPriceCents).toBe(29_000);
    expect(d.nextLastAlertPriceCents).toBe(29_000);
  });

  it("não repete o alerta enquanto o preço continua no mesmo patamar", () => {
    const states = [{ type: "preco_alvo" as const, isActive: true, lastAlertPriceCents: 29_000 }];
    const d = decisionOf(evaluateAlerts(input({ states })), "preco_alvo");
    expect(d.active).toBe(true);
    expect(d.shouldAlert).toBe(false);
  });

  it("preço-alvo não se repete enquanto a condição permanece verdadeira", () => {
    const states = [{ type: "preco_alvo" as const, isActive: true, lastAlertPriceCents: 29_000 }];
    const lower = decisionOf(evaluateAlerts(input({ states, offers: [offer({ priceCents: 27_000 })] })), "preco_alvo");
    expect(lower.active).toBe(true);
    expect(lower.shouldAlert).toBe(false);
  });

  it("queda percentual re-alerta somente quando o preço cai pelo menos o patamar configurado", () => {
    const states = [{ type: "queda_percentual" as const, isActive: true, lastAlertPriceCents: 29_000 }];
    const small = decisionOf(evaluateAlerts(input({ states, offers: [offer({ priceCents: 28_500 })] })), "queda_percentual");
    expect(small.active).toBe(true);
    expect(small.shouldAlert).toBe(false);
    const big = decisionOf(evaluateAlerts(input({ states, offers: [offer({ priceCents: 27_000 })] })), "queda_percentual");
    expect(big.shouldAlert).toBe(true);
  });

  it("volta a alertar depois que a condição deixa de valer e retorna", () => {
    const states = [{ type: "preco_alvo" as const, isActive: false, lastAlertPriceCents: null }];
    const d = decisionOf(evaluateAlerts(input({ states })), "preco_alvo");
    expect(d.shouldAlert).toBe(true);
  });

  it("oferta indisponível não dispara alerta", () => {
    const d = decisionOf(evaluateAlerts(input({ offers: [offer({ availability: "indisponivel" })] })), "preco_alvo");
    expect(d.active).toBe(false);
    expect(d.shouldAlert).toBe(false);
  });

  it("oferta com correspondência divergente não dispara alerta", () => {
    const d = decisionOf(evaluateAlerts(input({ offers: [offer({ matchStatus: "divergente" })] })), "preco_alvo");
    expect(d.shouldAlert).toBe(false);
  });

  it("frete conhecido entra no total comparável", () => {
    const d = decisionOf(
      evaluateAlerts(input({ offers: [offer({ priceCents: 28_000, shippingCents: 3_000, shippingKnown: true })] })),
      "preco_alvo",
    );
    expect(d.active).toBe(false); // 31.000 > alvo de 30.000
  });

  it("queda percentual usa somente histórico anterior e informa o motivo quando insuficiente", () => {
    const ok = decisionOf(evaluateAlerts(input()), "queda_percentual");
    expect(ok.active).toBe(true);
    expect(ok.candidate?.referencePriceCents).toBe(40_000);
    const insuf = decisionOf(evaluateAlerts(input({ history: [] })), "queda_percentual");
    expect(insuf.active).toBe(false);
    expect(insuf.skippedReason).toBeTruthy();
  });

  it("respeita eventos desativados nas configurações", () => {
    const off = { ...enabled, preco_alvo: false };
    const base = input();
    const d = decisionOf(evaluateAlerts({ ...base, settings: { ...base.settings, enabledEvents: off } }), "preco_alvo");
    expect(d.active).toBe(true);
    expect(d.shouldAlert).toBe(false);
  });
});
