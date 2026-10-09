/**
 * Executa uma rodada de coleta pelo terminal (mesmo caminho do cron).
 * Uso: npm run monitor:run   (requer DATABASE_URL; usa a API oficial do Mercado Livre)
 */
import { runCollection } from "../src/lib/monitoring/collector";

runCollection({ trigger: "cron", owner: `cli-${process.pid}` })
  .then((summary) => {
    console.log(JSON.stringify(summary, null, 2));
    process.exit(summary.status === "falhou" ? 2 : 0);
  })
  .catch((err) => {
    console.error("Falha na coleta:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
