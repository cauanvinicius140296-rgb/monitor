import { eq } from "drizzle-orm";
import { getDb, type Db } from "@/db/client";
import { settings } from "@/db/schema";
import { mergeSettings, type AppSettings } from "@/lib/settings-defaults";

export const SETTINGS_KEY = "app";

const ENV_MAP: Record<string, keyof AppSettings> = {
  COLETA_LOTE_MAXIMO: "batchSize",
  COLETA_MAX_POR_LOJA: "maxPerStorePerRun",
  COLETA_INTERVALO_MINIMO_HORAS: "intervalHours",
  COLETA_TIMEOUT_MS: "requestTimeoutMs",
  COLETA_ORCAMENTO_TEMPO_MS: "runBudgetMs",
};

export function envSettingsOverrides(source: NodeJS.ProcessEnv = process.env): Partial<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [envName, key] of Object.entries(ENV_MAP)) {
    const raw = source[envName];
    if (raw !== undefined && raw.trim() !== "" && Number.isFinite(Number(raw))) out[key] = Number(raw);
  }
  return out;
}

export async function loadSettings(db: Db = getDb()): Promise<AppSettings> {
  const rows = await db.select().from(settings).where(eq(settings.key, SETTINGS_KEY)).limit(1);
  const saved = (rows[0]?.value ?? {}) as Record<string, unknown>;
  return mergeSettings(saved, envSettingsOverrides());
}

/** Salva apenas as chaves informadas (merge sobre o que já existe no banco). */
export async function saveSettingsPatch(patch: Partial<AppSettings>, db: Db = getDb()): Promise<void> {
  const rows = await db.select().from(settings).where(eq(settings.key, SETTINGS_KEY)).limit(1);
  const current = (rows[0]?.value ?? {}) as Record<string, unknown>;
  const next = { ...current, ...patch };
  await db
    .insert(settings)
    .values({ key: SETTINGS_KEY, value: next })
    .onConflictDoUpdate({ target: settings.key, set: { value: next, updatedAt: new Date() } });
}
