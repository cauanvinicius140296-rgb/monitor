import { randomUUID } from "node:crypto";
import { runCollection } from "@/lib/monitoring/collector";
import { bearerToken, secretsMatch } from "@/lib/security/secret";
import { env } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Limite de duração da função (Vercel). O lote para antes por RUN_BUDGET_MS (< maxDuration).
export const maxDuration = 300;

/**
 * Endpoint do agendador (GitHub Actions ou Vercel Cron).
 * Protegido por `Authorization: Bearer <CRON_SECRET>`. Sem o segredo, responde 401.
 * Não é possível acioná-lo publicamente: sem CRON_SECRET configurado, responde 503.
 */
async function handle(request: Request): Promise<Response> {
  const expected = env("CRON_SECRET");
  if (!expected || expected.length < 24) {
    return Response.json({ error: "Agendador não configurado no servidor." }, { status: 503 });
  }
  const token = bearerToken(request.headers.get("authorization"));
  if (!secretsMatch(token, expected)) {
    return Response.json({ error: "Não autorizado." }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
  }
  try {
    const summary = await runCollection({ trigger: "cron", owner: `cron-${randomUUID()}` });
    return Response.json({
      status: summary.status,
      runId: summary.runId,
      message: summary.message,
      selected: summary.selected,
      ok: summary.ok,
      failed: summary.failed,
      deferred: summary.deferred,
      skippedNotConfigured: summary.skippedNotConfigured,
      alertsCreated: summary.alertsCreated,
      stoppedByBudget: summary.stoppedByBudget,
      perStore: summary.perStore,
    });
  } catch {
    // Detalhes técnicos ficam em monitoring_runs; a resposta não expõe internals.
    return Response.json({ status: "falhou", message: "Erro interno na coleta." }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
