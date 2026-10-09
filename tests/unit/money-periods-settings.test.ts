import { describe, expect, it } from "vitest";
import { formatBRL, formatPercent, parseMoneyToCents, percentDrop } from "@/lib/money";
import { parsePeriod, periodStart } from "@/lib/periods";
import { DEFAULT_SETTINGS, mergeSettings, SETTING_RANGES } from "@/lib/settings-defaults";
import { formatDateTime, timeAgo } from "@/lib/format";
import { normalizeGtin } from "@/lib/analysis/matching";

describe("dinheiro em centavos", () => {
  it("interpreta formatos brasileiros e rejeita entradas inválidas", () => {
    expect(parseMoneyToCents("1.299,90")).toBe(129_990);
    expect(parseMoneyToCents("R$ 1.299")).toBe(129_900);
    expect(parseMoneyToCents("1299.90")).toBe(129_990);
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents(-5)).toBeNull();
  });

  it("formata em reais com vírgula e aceita nulo", () => {
    expect(formatBRL(129_990)).toMatch(/1\.299,90/);
    expect(formatBRL(null)).toBe("—");
  });

  it("calcula queda percentual em relação à referência (positivo = caiu)", () => {
    expect(percentDrop(10_000, 9_000)).toBeCloseTo(10, 5);
    expect(percentDrop(10_000, 11_000)).toBeCloseTo(-10, 5);
    expect(percentDrop(0, 100)).toBeNull();
    expect(formatPercent(12.345)).toMatch(/12,3/);
  });
});

describe("períodos do gráfico", () => {
  const now = new Date("2026-10-09T12:00:00Z");
  it("usa 30 dias por padrão e calcula início de cada período", () => {
    expect(parsePeriod("xyz")).toBe("30d");
    expect(parsePeriod(["7d"])).toBe("7d");
    expect(periodStart("24h", now)?.toISOString()).toBe("2026-10-08T12:00:00.000Z");
    expect(periodStart("all", now)).toBeNull();
  });
});

describe("configurações padrão e mesclagem", () => {
  it("padrões: intervalo de 6 h, lote de 20 e limite de 10 por loja", () => {
    expect(DEFAULT_SETTINGS.intervalHours).toBe(6);
    expect(DEFAULT_SETTINGS.batchSize).toBe(20);
    expect(DEFAULT_SETTINGS.maxPerStorePerRun).toBe(10);
  });

  it("valor salvo prevalece sobre padrão; valor fora da faixa é descartado", () => {
    const s = mergeSettings({ intervalHours: 12, batchSize: 100_000 });
    expect(s.intervalHours).toBe(12);
    expect(s.batchSize).toBe(DEFAULT_SETTINGS.batchSize);
  });

  it("ordem de precedência: padrão < variável de ambiente < valor salvo no banco", () => {
    expect(mergeSettings({}, { batchSize: 7 }).batchSize).toBe(7);
    expect(mergeSettings({ batchSize: 5 }, { batchSize: 7 }).batchSize).toBe(5);
  });

  it("referência inválida volta ao padrão", () => {
    expect(mergeSettings({ referenceMode: "inventado" }).referenceMode).toBe(DEFAULT_SETTINGS.referenceMode);
  });

  it("todas as faixas numéricas são válidas", () => {
    for (const [k, [min, max]] of Object.entries(SETTING_RANGES)) {
      const v = (DEFAULT_SETTINGS as unknown as Record<string, number>)[k];
      expect(v, k).toBeGreaterThanOrEqual(min as number);
      expect(v, k).toBeLessThanOrEqual(max as number);
    }
  });
});

describe("datas e GTIN", () => {
  it("formata datas em pt-BR e descreve há quanto tempo", () => {
    const now = new Date("2026-10-09T12:00:00Z");
    expect(formatDateTime(null)).toBe("—");
    expect(timeAgo(new Date("2026-10-09T09:00:00Z"), now)).toMatch(/3 h|3h|há 3/);
    expect(typeof formatDateTime(now)).toBe("string");
  });

  it("normaliza GTIN removendo máscara", () => {
    expect(normalizeGtin("789.123.456.7895")).toBe("7891234567895");
  });
});
