import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import { assertServerRuntime, requireEnv } from "@/lib/env";
import { isLocalDatabaseUrl } from "@/lib/db-url";

export type Db = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as {
  __radarSql?: postgres.Sql;
  __radarDb?: Db;
};

/**
 * Cliente singleton do banco. `prepare: false` é necessário para o endpoint
 * "pooled" do Neon (PgBouncer em modo transação), que não suporta prepared statements.
 * A string de conexão nunca é enviada ao navegador.
 */
export function getDb(): Db {
  assertServerRuntime();
  if (!globalForDb.__radarDb) {
    const url = requireEnv("DATABASE_URL");
    const isLocal = isLocalDatabaseUrl(url);
    const sql = postgres(url, {
      prepare: false,
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      idle_timeout: 20,
      connect_timeout: 15,
      ssl: isLocal ? false : "require",
    });
    globalForDb.__radarSql = sql;
    globalForDb.__radarDb = drizzle(sql, { schema });
  }
  return globalForDb.__radarDb;
}

/** Encerra conexões (usado por scripts e testes). */
export async function closeDb(): Promise<void> {
  const sql = globalForDb.__radarSql;
  globalForDb.__radarSql = undefined;
  globalForDb.__radarDb = undefined;
  if (sql) await sql.end({ timeout: 5 });
}
