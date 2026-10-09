import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/db/client";
import { alerts, products, stores } from "@/db/schema";
import { ALERT_LABELS, ALERT_TYPES, type AlertType } from "@/lib/analysis/alerts-engine";
import { formatBRL } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { Badge, btnSecondary, Card, EmptyState, PageHeader, Pagination } from "@/components/ui";
import { setAlertStatusAction, markAllAlertsReadAction } from "@/app/actions/alerts";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const STATUS_FILTERS = ["nao_lido", "lido", "arquivado", "todos"] as const;
type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function AlertasPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await searchParams;
  const statusParam = (STATUS_FILTERS as readonly string[]).includes(first(sp.status)) ? first(sp.status) : "nao_lido";
  const typeParam = (ALERT_TYPES as readonly string[]).includes(first(sp.tipo)) ? first(sp.tipo) : "";
  const page = Math.max(1, Number(first(sp.pagina)) || 1);

  const db = getDb();
  const conditions = [];
  if (statusParam !== "todos") conditions.push(eq(alerts.status, statusParam as "nao_lido" | "lido" | "arquivado"));
  if (typeParam) conditions.push(eq(alerts.type, typeParam as AlertType));
  const where = conditions.length ? sql.join(conditions, sql` and `) : sql`true`;

  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(alerts).where(where);
  const totalPages = Math.max(1, Math.ceil(n / PAGE_SIZE));
  const rows = await db
    .select({
      id: alerts.id,
      type: alerts.type,
      status: alerts.status,
      title: alerts.title,
      message: alerts.message,
      observedPriceCents: alerts.observedPriceCents,
      targetPriceCents: alerts.targetPriceCents,
      referencePriceCents: alerts.referencePriceCents,
      offerUrl: alerts.offerUrl,
      createdAt: alerts.createdAt,
      productId: alerts.productId,
      productName: products.name,
      storeName: stores.name,
    })
    .from(alerts)
    .leftJoin(products, eq(alerts.productId, products.id))
    .leftJoin(stores, eq(alerts.storeId, stores.id))
    .where(where)
    .orderBy(desc(alerts.createdAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  const params = { status: statusParam, tipo: typeParam || undefined };

  return (
    <>
      <PageHeader
        title="Alertas"
        subtitle="Eventos internos gerados quando um preço atinge uma regra. Um alerta não se repete enquanto o preço continuar no mesmo patamar."
        actions={
          <>
            <Link href="/configuracoes#eventos" className={btnSecondary}>Configurar eventos</Link>
            {statusParam === "nao_lido" ? (
              <form action={markAllAlertsReadAction}>
                <button type="submit" className={btnSecondary}>Marcar todos como lidos</button>
              </form>
            ) : null}
          </>
        }
      />

      <Card className="mb-4">
        <form method="get" className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-slate-700">
            Situação
            <select name="status" defaultValue={statusParam} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="nao_lido">Não lidos</option>
              <option value="lido">Lidos</option>
              <option value="arquivado">Arquivados</option>
              <option value="todos">Todos</option>
            </select>
          </label>
          <label className="text-sm text-slate-700">
            Tipo
            <select name="tipo" defaultValue={typeParam} className="mt-1 block rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="">Todos os tipos</option>
              {ALERT_TYPES.map((t) => (
                <option key={t} value={t}>{ALERT_LABELS[t]}</option>
              ))}
            </select>
          </label>
          <button type="submit" className={btnSecondary}>Filtrar</button>
        </form>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <EmptyState title="Nenhum alerta com este filtro.">Os alertas aparecem após as atualizações de preço.</EmptyState>
        </Card>
      ) : (
        <ul className="space-y-3">
          {rows.map((a) => (
            <li key={a.id}>
              <Card className="!p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={a.status === "nao_lido" ? "danger" : "neutral"}>{a.status === "nao_lido" ? "Não lido" : a.status === "lido" ? "Lido" : "Arquivado"}</Badge>
                      <Badge tone="info">{ALERT_LABELS[a.type as AlertType] ?? a.type}</Badge>
                      <span className="text-xs text-slate-500">{formatDateTime(a.createdAt)}</span>
                    </div>
                    <p className="font-medium text-slate-900">{a.title}</p>
                    <p className="text-sm text-slate-600">{a.message}</p>
                    <p className="text-xs text-slate-500">
                      {a.productName ? (
                        <Link href={`/produtos/${a.productId}`} className="font-medium text-indigo-600 hover:underline">{a.productName}</Link>
                      ) : (
                        "Produto removido"
                      )}
                      {a.storeName ? ` · ${a.storeName}` : ""}
                      {a.observedPriceCents !== null ? ` · observado ${formatBRL(a.observedPriceCents)}` : ""}
                      {a.targetPriceCents !== null ? ` · alvo ${formatBRL(a.targetPriceCents)}` : ""}
                      {a.referencePriceCents !== null ? ` · referência ${formatBRL(a.referencePriceCents)}` : ""}
                    </p>
                    {a.offerUrl ? (
                      <a href={a.offerUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-xs text-indigo-600 hover:underline">Abrir oferta ↗</a>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {a.status !== "lido" ? (
                      <form action={setAlertStatusAction}>
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="status" value="lido" />
                        <button type="submit" className={btnSecondary}>Marcar lido</button>
                      </form>
                    ) : null}
                    {a.status !== "arquivado" ? (
                      <form action={setAlertStatusAction}>
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="status" value="arquivado" />
                        <button type="submit" className={btnSecondary}>Arquivar</button>
                      </form>
                    ) : null}
                    {a.status !== "nao_lido" ? (
                      <form action={setAlertStatusAction}>
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="status" value="nao_lido" />
                        <button type="submit" className={btnSecondary}>Reabrir</button>
                      </form>
                    ) : null}
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4">
        <Pagination basePath="/alertas" params={params} page={page} totalPages={totalPages} />
      </div>
    </>
  );
}
