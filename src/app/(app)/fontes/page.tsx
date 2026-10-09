import { desc, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/db/client";
import { monitoringRuns, offers, stores } from "@/db/schema";
import { loadSettings } from "@/lib/repos/settings-repo";
import { STORE_CATALOG } from "@/lib/stores-catalog";
import { formatDateTime, timeAgo } from "@/lib/format";
import { Badge, Card, CardTitle, EmptyState, Notice, PageHeader } from "@/components/ui";
import { FormWithState } from "@/components/form-with-state";
import { testMercadoLivreAction } from "@/app/actions/sources";

export const dynamic = "force-dynamic";

const RUN_STATUS: Record<string, string> = {
  executando: "executando",
  concluido: "concluído",
  parcial: "parcial",
  falhou: "falhou",
  ignorado: "ignorado",
};

export default async function FontesPage() {
  await requireUser();
  const now = new Date();
  const db = getDb();
  const settings = await loadSettings(db);

  const storeRows = await db
    .select({
      id: stores.id,
      slug: stores.slug,
      name: stores.name,
      integrationMode: stores.integrationMode,
      automated: stores.automated,
      integrationNote: stores.integrationNote,
      consecutiveFailures: stores.consecutiveFailures,
      lastSuccessAt: stores.lastSuccessAt,
      lastFailureAt: stores.lastFailureAt,
      lastError: stores.lastError,
      offerCount: sql<number>`(select count(*)::int from ${offers} where ${offers.storeId} = ${stores.id} and ${offers.isActive})`,
    })
    .from(stores)
    .orderBy(stores.name);

  const runs = await db
    .select()
    .from(monitoringRuns)
    .orderBy(desc(monitoringRuns.startedAt))
    .limit(20);

  const catalogOnly = STORE_CATALOG.filter((c) => !storeRows.some((s) => s.slug === c.slug));

  return (
    <>
      <PageHeader
        title="Fontes"
        subtitle="Situação das lojas, forma de atualização e últimas execuções de coleta."
      />

      <Notice tone="info">
        Só são consultadas automaticamente as lojas com integração por API oficial. As demais exigem atualização manual ou credenciais/programa
        da própria loja. O Radar não contorna CAPTCHA, login obrigatório, limites de acesso ou outras proteções.
      </Notice>

      <Card className="mt-4">
        <CardTitle>Teste de conexão — Mercado Livre</CardTitle>
        <p className="mb-3 text-sm text-slate-600">
          Consulta real à API oficial a partir deste servidor (busca de teste e, com token, validação da conta). Nenhum token é exibido.
        </p>
        <FormWithState action={testMercadoLivreAction} submitLabel="Testar conexão agora" pendingLabel="Testando…" className="space-y-2">
          <span />
        </FormWithState>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {storeRows.map((s) => {
          const unavailable = s.consecutiveFailures >= settings.storeFailureThreshold;
          return (
            <Card key={s.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-slate-900">{s.name}</h2>
                <div className="flex flex-wrap gap-1.5">
                  {unavailable ? <Badge tone="danger">Indisponível ({s.consecutiveFailures} falhas)</Badge> : s.consecutiveFailures > 0 ? <Badge tone="warning">{s.consecutiveFailures} falha(s)</Badge> : <Badge tone="success">Operando</Badge>}
                  <Badge tone={s.integrationMode === "api" ? "info" : "neutral"}>{s.integrationMode === "api" ? "API oficial" : s.integrationMode === "manual" ? "Atualização manual" : "Integração pendente"}</Badge>
                  {s.automated ? <Badge tone="success">Automática</Badge> : null}
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div><dt className="text-xs text-slate-500">Ofertas ativas</dt><dd className="font-medium tabular-nums">{s.offerCount}</dd></div>
                <div><dt className="text-xs text-slate-500">Último sucesso</dt><dd>{s.lastSuccessAt ? `${formatDateTime(s.lastSuccessAt)} (${timeAgo(s.lastSuccessAt, now)})` : "—"}</dd></div>
                <div><dt className="text-xs text-slate-500">Última falha</dt><dd>{s.lastFailureAt ? formatDateTime(s.lastFailureAt) : "—"}</dd></div>
              </dl>
              {s.lastError ? <p className="mt-2 text-xs text-rose-700">Último erro: {s.lastError}</p> : null}
              {s.integrationNote ? <p className="mt-3 text-xs text-slate-600">{s.integrationNote}</p> : null}
            </Card>
          );
        })}
      </div>

      {catalogOnly.length > 0 ? (
        <Card className="mt-4">
          <CardTitle>Lojas previstas (ainda sem registro no banco)</CardTitle>
          <ul className="space-y-2 text-sm text-slate-600">
            {catalogOnly.map((c) => (
              <li key={c.slug}><strong className="text-slate-800">{c.name}</strong> — {c.integrationNote}</li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card className="mt-4">
        <CardTitle>Últimas execuções de coleta</CardTitle>
        {runs.length === 0 ? (
          <EmptyState title="Nenhuma execução registrada ainda." />
        ) : (
          <div className="table-wrap">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-3 font-medium">Início</th>
                  <th className="py-2 pr-3 font-medium">Origem</th>
                  <th className="py-2 pr-3 font-medium">Resultado</th>
                  <th className="py-2 pr-3 font-medium">Ofertas</th>
                  <th className="py-2 pr-3 font-medium">Alertas</th>
                  <th className="py-2 font-medium">Erro</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2 pr-3 whitespace-nowrap">{formatDateTime(r.startedAt)}</td>
                    <td className="py-2 pr-3">{r.trigger === "cron" ? "Agendada" : "Manual"}</td>
                    <td className="py-2 pr-3">
                      <Badge tone={r.status === "concluido" ? "success" : r.status === "falhou" ? "danger" : r.status === "parcial" ? "warning" : "neutral"}>{RUN_STATUS[r.status] ?? r.status}</Badge>
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{r.offersOk}/{r.offersSelected} ok{r.offersFailed ? ` · ${r.offersFailed} falha(s)` : ""}</td>
                    <td className="py-2 pr-3 tabular-nums">{r.alertsCreated}</td>
                    <td className="py-2 max-w-xs truncate text-xs text-rose-700" title={r.errorSummary ?? ""}>{r.errorSummary ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
