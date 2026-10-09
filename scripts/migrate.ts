/**
 * Aplica as migrations do Drizzle e garante os dados básicos (lojas e job de coleta).
 * Uso: npm run db:migrate   (requer DATABASE_URL)
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../src/db/schema";
import { ensureBaseData } from "../src/db/bootstrap";
import { isLocalDatabaseUrl } from "../src/lib/db-url";

const here = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL não definida.");
  const isLocal = isLocalDatabaseUrl(url);
  const sql = postgres(url, { max: 1, prepare: false, ssl: isLocal ? false : "require" });
  try {
    const db = drizzle(sql, { schema });
    await migrate(db, { migrationsFolder: path.resolve(here, "../drizzle") });
    await ensureBaseData(db);
    console.log("Migrations aplicadas e dados básicos garantidos.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("Falha ao aplicar migrations:", err instanceof Error ? err.message : err);
  process.exit(1);
});
