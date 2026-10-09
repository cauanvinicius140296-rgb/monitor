import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/db/client";
import { loadSettings } from "@/lib/repos/settings-repo";
import { loadDashboard } from "@/lib/repos/dashboard";
import { REFERENCE_LABELS } from "@/lib/analysis/references";
import { formatBRL, formatPercent } from "@/lib/money";
import { formatDateTime, timeAgo } from "@/lib/format";
import { Badge, Card, CardTitle, EmptyState, PageHeader, StatCard } from "@/components/ui";
import { RunCollectionButton } from "@/components/run-collection-button";

export const dynamic = "force-dynamic";

const RUN_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  concluido: "success",
  parcial: "warning",
  falhou: "danger",
  ignorado: "neutral",
  executando: "neutral",
};

export default async function DashboardPage() {
  await requireUser();
  const db = getDb();
  const now = new Date();
  const settings = await loadSettings(db);
  const d = await loadDashboard(db, now, settings);

  return (
    <>
      <PageHeader
        title="Painel"
        subtitle={
          <>
            Visão geral dos seus produtos. Economia calculada com a referência: <strong>{REFERENCE_LABELS[d.referenceMode]}</strong>.
          </>
        }
        actions={<RunCollectionButton label="Consultar fontes agora" />}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Produtos monitorados" value={d.monitored} hint={<Link href="/produtos" className="text-indigo-600 hover:underline">Ver produtos</Link>} />
        <StatCard label="Ofertas ativas" value={d.activeOffers} />
        <StatCard label="Atingiram o preço-alvo" value={d.targetReached.length} tone="success" hint={`${d.budgetReached.length} dentro do orçamento`} />
        <StatCard
          label={`Quedas recentes (≥ ${d.dropThresholdPercent}%)`}
          value={d.recentDrops.length}
          tone={d.recentDrops.length ? "warning" : "default"}
          hint={`Janela de ${d.dropWindowDays} dias`}
        />
        <StatCard label="Economia potencial" value={formatBRL(d.potentialSavingCents)} tone="info" hint={`${d.productsWithSaving} produto(s) abaixo da referência`} />
        <StatCard label="Alertas não lidos" value={d.unreadAlerts} tone={d.unreadAlerts ? "danger" : "default"} hint={<Link href="/alertas" className="text-indigo-600 hover:underline">Abrir alertas</Link>} />
        <StatCard label="Preços desatualizados" value={d.staleOffersCount} tone={d.staleOffersCount ? "warning" : "default"} hint="Ofertas sem coleta recente" />
        <StatCard
          label="Fontes com falhas"
          value={d.failingStores.length}
          tone={d.failingStores.length ? "danger" : "success"}
          hint={d.failingStores.length ? "Veja a aba Fontes" : "Nenhuma falha registrada"}
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardTitle>Atingiram o preço-alvo</CardTitle>
          {d.targetReached.length === 0 ? (
            <EmptyState title="Nenhum produto atingiu o preço-alvo ainda.">Defina preços-alvo nos produtos para acompanhar.</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {d.targetReached.slice(0, 6).map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                  <Link href={`/produtos/${p.id}`} className="min-w-0 truncate text-sm font-medium text-slate-800 hover:text-indigo-700">
                    {p.name}
                  </Link>
                  <span className="shrink-0 text-sm tabular-nums">
                    <span className="font-semibold text-emerald-700">{formatBRL(p.bestComparableCents)}</span>
                    <span className="text-slate-400"> · alvo {formatBRL(p.targetPriceCents)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>Quedas recentes</CardTitle>
          {d.recentDrops.length === 0 ? (
            <EmptyState title="Nenhuma queda relevante na janela configurada." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {d.recentDrops.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                  <Link href={`/produtos/${p.id}`} className="min-w-0 truncate text-sm font-medium text-slate-800 hover:text-indigo-700">
                    {p.name}
                  </Link>
                  <span className="shrink-0 text-sm">
                    <Badge tone="warning">−{formatPercent(p.dropPercent)}</Badge>{" "}
                    <span className="tabular-nums">{formatBRL(p.bestComparableCents)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>Últimos alertas</CardTitle>
          {d.recentAlerts.length === 0 ? (
            <EmptyState title="Nenhum alerta gerado ainda." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {d.recentAlerts.map((a) => (
                <li key={a.id} className="py-2.5">
                  <Link href="/alertas" className="text-sm font-medium text-slate-800 hover:text-indigo-700">
                    {a.title}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {formatDateTime(a.createdAt)} · {a.status === "nao_lido" ? <Badge tone="danger">não lido</Badge> : <Badge>{a.status === "lido" ? "lido" : "arquivado"}</Badge>}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle action={<Link href="/fontes" className="text-sm text-indigo-600 hover:underline">Detalhes</Link>}>Fontes com falhas</CardTitle>
          {d.failingStores.length === 0 ? (
            <EmptyState title="Nenhuma fonte com falhas consecutivas." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {d.failingStores.map((s) => (
                <li key={s.slug} className="py-2.5">
                  <p className="text-sm font-medium text-slate-800">
                    {s.name} <Badge tone="danger">{s.consecutiveFailures} falha(s) seguida(s)</Badge>
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{s.lastError ?? "Sem detalhes."}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>Últimas atualizações</CardTitle>
          {d.recentUpdates.length === 0 ? (
            <EmptyState title="Nenhuma coleta registrada ainda.">Cadastre um produto com link de uma loja e atualize.</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {d.recentUpdates.map((u, i) => (
                <li key={`${u.productId}-${i}`} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <Link href={`/produtos/${u.productId}`} className="block truncate text-sm font-medium text-slate-800 hover:text-indigo-700">
                      {u.productName}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {u.storeName} · {formatDateTime(u.collectedAt)}
                    </p>
                  </div>
                  {u.status === "sucesso" ? (
                    <span className="shrink-0 text-sm font-semibold tabular-nums">{formatBRL(u.priceCents)}</span>
                  ) : (
                    <Badge tone="danger">falha</Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>Produtos com preços desatualizados</CardTitle>
          {d.staleProducts.length === 0 ? (
            <EmptyState title="Todos os preços estão atualizados." />
          ) : (
            <ul className="divide-y divide-slate-100">
              {d.staleProducts.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                  <Link href={`/produtos/${p.id}`} className="min-w-0 truncate text-sm font-medium text-slate-800 hover:text-indigo-700">
                    {p.name}
                  </Link>
                  <Badge tone="warning">{p.staleOffers} oferta(s)</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardTitle>Execuções recentes do monitoramento</CardTitle>
          {d.recentRuns.length === 0 ? (
            <EmptyState title="Nenhuma execução registrada." />
          ) : (
            <div className="table-wrap">
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Quando</th>
                    <th className="py-2 pr-3 font-medium">Origem</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Consultadas</th>
                    <th className="py-2 font-medium">Falhas</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {d.recentRuns.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {formatDateTime(r.startedAt)} <span className="text-xs text-slate-400">({timeAgo(r.startedAt, now)})</span>
                      </td>
                      <td className="py-2 pr-3">{r.trigger === "cron" ? "Agendada" : "Manual"}</td>
                      <td className="py-2 pr-3">
                        <Badge tone={RUN_TONE[r.status] ?? "neutral"}>{r.status}</Badge>
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{r.selected}</td>
                      <td className="py-2 tabular-nums">{r.failed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      <p className="mt-6 text-xs text-slate-400">
        Os preços exibidos vêm das fontes monitoradas ou de registros feitos por você. Nenhum valor de demonstração aparece sem o rótulo “DEMO”.
      </p>
    </>
  );
}

