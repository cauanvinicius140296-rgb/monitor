import { sql } from "drizzle-orm";
import { getDb, type Db } from "./client";
import { monitoringJobs, stores } from "./schema";
import { STORE_CATALOG } from "@/lib/stores-catalog";

export const JOB_COLETA_AUTOMATICA = "coleta_automatica";

/**
 * Garante dados básicos (catálogo de lojas e job de monitoramento).
 * Idempotente: pode ser executado a qualquer momento sem duplicar registros.
 * Não altera dados de saúde das lojas (falhas, últimas coletas).
 */
export async function ensureBaseData(db: Db = getDb()): Promise<void> {
  for (const s of STORE_CATALOG) {
    await db
      .insert(stores)
      .values({
        slug: s.slug,
        name: s.name,
        domains: s.domains,
        adapterKey: s.adapterKey,
        integrationMode: s.integrationMode,
        automated: s.automated,
        integrationNote: s.integrationNote,
      })
      .onConflictDoUpdate({
        target: stores.slug,
        set: {
          name: s.name,
          domains: s.domains,
          adapterKey: s.adapterKey,
          integrationMode: s.integrationMode,
          automated: s.automated,
          integrationNote: s.integrationNote,
          updatedAt: sql`now()`,
        },
      });
  }
  await db
    .insert(monitoringJobs)
    .values({ name: JOB_COLETA_AUTOMATICA, enabled: true })
    .onConflictDoNothing({ target: monitoringJobs.name });
}

let bootstrapPromise: Promise<void> | null = null;

/** Executa o bootstrap uma vez por processo. */
export function ensureBootstrapped(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = ensureBaseData().catch((err) => {
      bootstrapPromise = null;
      throw err;
    });
  }
  return bootstrapPromise;
}
