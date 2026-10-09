/**
 * Sobe um PostgreSQL real (embedded-postgres) para os testes de integração.
 * Um cluster novo é criado a cada execução e removido ao final. Nunca usa o banco de produção.
 */
import EmbeddedPostgres from "embedded-postgres";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../src/db/schema";
import { ensureBaseData } from "../../src/db/bootstrap";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../..");
const DATA_DIR = path.join(ROOT, ".pgdata-test");
const PORT = Number(process.env.RADAR_TEST_PG_PORT ?? 54399);

export default async function setup(): Promise<() => Promise<void>> {
  rmSync(DATA_DIR, { recursive: true, force: true });
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: "postgres",
    password: "postgres",
    port: PORT,
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("radar_test");

  const url = `postgresql://postgres:postgres@127.0.0.1:${PORT}/radar_test`;
  process.env.DATABASE_URL = url;
  process.env.SESSION_SECRET = "teste-sessao-com-mais-de-trinta-e-dois-caracteres";
  process.env.CRON_SECRET = "teste-cron-segredo-com-mais-de-24-caracteres";
  process.env.APP_URL = "http://localhost:3000";

  const sql = postgres(url, { max: 1, prepare: false, ssl: false });
  try {
    const db = drizzle(sql, { schema });
    await migrate(db, { migrationsFolder: path.join(ROOT, "drizzle") });
    await ensureBaseData(db);
  } finally {
    await sql.end({ timeout: 5 });
  }

  return async () => {
    await pg.stop();
    rmSync(DATA_DIR, { recursive: true, force: true });
  };
}
