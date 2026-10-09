/**
 * Sobe um PostgreSQL local embutido (embedded-postgres) para desenvolvimento/preview.
 * Uso: node scripts/local-pg.mjs   (porta padrão 54432, dados em .pgdata-local)
 * A connection string fica impressa na saída. Não usar em produção.
 */
import EmbeddedPostgres from "embedded-postgres";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const PORT = Number(process.env.RADAR_LOCAL_PG_PORT ?? 54432);

const pg = new EmbeddedPostgres({
  databaseDir: path.join(ROOT, ".pgdata-local"),
  user: "postgres",
  password: "postgres",
  port: PORT,
  persistent: true,
  onLog: () => {},
  onError: (line) => console.error("[pg]", line),
});

await pg.initialise();
await pg.start();
try {
  await pg.createDatabase("radar_local");
} catch {
  /* banco já existe */
}
console.log(`DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:${PORT}/radar_local`);
console.log("PostgreSQL local no ar. Ctrl+C para parar.");

process.on("SIGTERM", async () => {
  await pg.stop();
  process.exit(0);
});
process.on("SIGINT", async () => {
  await pg.stop();
  process.exit(0);
});
