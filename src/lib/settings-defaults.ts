import { REFERENCE_MODES, type ReferenceMode } from "./analysis/references";
import { ALERT_TYPES, type AlertType } from "./analysis/alerts-engine";

export interface AppSettings {
  /** Intervalo mínimo entre consultas automáticas de uma mesma oferta (horas). */
  intervalHours: number;
  /** Máximo de ofertas consultadas por execução. */
  batchSize: number;
  /** Máximo de consultas por loja em cada execução (limite por fonte). */
  maxPerStorePerRun: number;
  /** Pausa entre requisições à mesma fonte (ms). */
  minDelayBetweenRequestsMs: number;
  /** Intervalo mínimo entre atualizações manuais de um mesmo produto (minutos). */
  manualCooldownMinutes: number;
  requestTimeoutMs: number;
  /** Tempo máximo de uma execução em lote (ms). Deve ficar abaixo do maxDuration da hospedagem. */
  runBudgetMs: number;
  /** Número de falhas seguidas até marcar a fonte como indisponível. */
  storeFailureThreshold: number;
  /** Quantas vezes o preço atual precisa estar abaixo para caracterizar "dados desatualizados". */
  staleAfterIntervals: number;
  dropThresholdPercent: number;
  dropWindowDays: number;
  realertDropPercent: number;
  otherStoreThresholdPercent: number;
  referenceMode: ReferenceMode;
  alertEvents: Record<AlertType, boolean>;
}

export const DEFAULT_SETTINGS: AppSettings = {
  intervalHours: 6,
  batchSize: 20,
  maxPerStorePerRun: 10,
  minDelayBetweenRequestsMs: 1000,
  manualCooldownMinutes: 10,
  requestTimeoutMs: 10_000,
  runBudgetMs: 240_000,
  storeFailureThreshold: 3,
  staleAfterIntervals: 2,
  dropThresholdPercent: 10,
  dropWindowDays: 7,
  realertDropPercent: 5,
  otherStoreThresholdPercent: 5,
  referenceMode: "maior_90d",
  alertEvents: Object.fromEntries(ALERT_TYPES.map((t) => [t, true])) as Record<AlertType, boolean>,
};

/** Limites numéricos com faixa aceita (validação no servidor). */
export const SETTING_RANGES: Partial<Record<keyof AppSettings, [number, number]>> = {
  intervalHours: [1, 168],
  batchSize: [1, 200],
  maxPerStorePerRun: [1, 100],
  minDelayBetweenRequestsMs: [0, 60_000],
  manualCooldownMinutes: [0, 1440],
  requestTimeoutMs: [1000, 60_000],
  runBudgetMs: [10_000, 280_000],
  storeFailureThreshold: [1, 20],
  staleAfterIntervals: [1, 10],
  dropThresholdPercent: [1, 90],
  dropWindowDays: [1, 90],
  realertDropPercent: [1, 50],
  otherStoreThresholdPercent: [1, 90],
};

/**
 * Mescla configurações: padrão < variáveis de ambiente (COLETA_*) < valores salvos no banco.
 * Valores fora da faixa são descartados.
 */
export function mergeSettings(
  saved: Partial<Record<string, unknown>>,
  envOverrides: Partial<Record<string, unknown>> = {},
): AppSettings {
  const out: AppSettings = structuredClone(DEFAULT_SETTINGS);
  const apply = (source: Partial<Record<string, unknown>>) => {
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]) {
      const value = source[key];
      if (value === undefined || value === null) continue;
      if (key === "referenceMode") {
        if ((REFERENCE_MODES as readonly string[]).includes(String(value))) out.referenceMode = value as ReferenceMode;
        continue;
      }
      if (key === "alertEvents") {
        if (typeof value === "object") {
          for (const t of ALERT_TYPES) {
            const v = (value as Record<string, unknown>)[t];
            if (typeof v === "boolean") out.alertEvents[t] = v;
          }
        }
        continue;
      }
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      const range = SETTING_RANGES[key];
      if (range && (value < range[0] || value > range[1])) continue;
      (out as unknown as Record<string, unknown>)[key] = value;
    }
  };
  apply(envOverrides);
  apply(saved);
  return out;
}
