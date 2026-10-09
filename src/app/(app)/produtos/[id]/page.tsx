import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/db/client";
import { alerts, priceHistory, products, purchases, stores } from "@/db/schema";
import { loadSettings } from "@/lib/repos/settings-repo";
import { loadCatalog } from "@/lib/repos/catalog";
import { summarizePoints } from "@/lib/analysis/history";
import { buildSeries } from "@/lib/analysis/series";
import { parsePeriod, PERIOD_KEYS, PERIOD_LABELS, periodStart } from "@/lib/periods";
import { formatDateTime, formatDate, timeAgo } from "@/lib/format";
import { AVAILABILITY_LABELS, MATCH_LABELS, PRIORITY_LABELS, STATUS_LABELS } from "@/lib/constants";
import { CONFIDENCE_LABEL } from "@/lib/analysis/confidence";
import { ALERT_LABELS } from "@/lib/analysis/alerts-engine";
import { REFERENCE_LABELS } from "@/lib/analysis/references";
import { Badge, Card, CardTitle, EmptyState, Notice, PageHeader, StatCard, btnSecondary } from "@/components/ui";
import { PriceChart } from "@/components/price-chart";
import { RunCollectionButton } from "@/components/run-collection-button";
import { ProductForm } from "@/components/product-form";
import { centsToInput, formatBRL, formatPercent } from "@/lib/money";
import { OfferAddForm, ManualPriceForm, PurchaseForm } from "@/components/forms";
import { updateProductAction, setProductStatusAction } from "@/app/actions/products";
import { addOfferAction, registerManualPriceAction, setOfferMatchAction, toggleOfferAction } from "@/app/actions/offers";
import { registerPurchaseAction } from "@/app/actions/purchases";
import { setAlertStatusAction } from "@/app/actions/alerts";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export default async function ProdutoDetalhePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SP>;
}) {
  await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const now = new Date();
  const db = getDb();
  const settings = await loadSettings(db);
  const [view] = await loadCatalog(db, { now, settings, filter: { productIds: [id], includeArchived: true } });
  if (!view) notFound();

  const period = parsePeriod(sp.periodo);
  const since = periodStart(period, now);

  const seriesRows = await db
    .select({
      collectedAt: priceHistory.collectedAt,
      storeSlug: stores.slug,
      storeName: stores.name,
      priceCents: priceHistory.priceCents,
      totalCents: priceHistory.totalCents,
      shippingKnown: priceHistory.shippingKnown,
    })
    .from(priceHistory)
    .innerJoin(stores, eq(priceHistory.storeId, stores.id))
    .where(
      and(
        eq(priceHistory.productId, id),
        eq(priceHistory.status, "sucesso"),
        sql`${priceHistory.priceCents} is not null`,
        since ? gte(priceHistory.collectedAt, since) : sql`true`,
      ),
    )
    .orderBy(priceHistory.collectedAt);

  const points = seriesRows.map((r) => ({
    collectedAt: new Date(r.collectedAt),
    storeSlug: r.storeSlug,
    storeName: r.storeName,
    comparableCents: (r.shippingKnown && r.totalCents !== null ? r.totalCents : r.priceCents) as number,
  }));
  const { data: chartData, series } = buildSeries(points);
  const summary = summarizePoints(points.map((p) => ({ priceCents: p.comparableCents, collectedAt: p.collectedAt, storeId: p.storeSlug, storeName: p.storeName })));
  const perStore = [...new Set(points.map((p) => p.storeSlug))].map((slug) => {
    const pts = points.filter((p) => p.storeSlug === slug);
    return { slug, name: pts[0].storeName, summary: summarizePoints(pts.map((p) => ({ priceCents: p.comparableCents, collectedAt: p.collectedAt }))) };
  });

  const logs = await db
    .select({
      id: priceHistory.id,
      collectedAt: priceHistory.collectedAt,
      status: priceHistory.status,
      priceCents: priceHistory.priceCents,
      shippingCents: priceHistory.shippingCents,
      shippingKnown: priceHistory.shippingKnown,
      availability: priceHistory.availability,
      source: priceHistory.source,
      errorCode: priceHistory.errorCode,
      errorMessage: priceHistory.errorMessage,
      storeName: stores.name,
    })
    .from(priceHistory)
    .innerJoin(stores, eq(priceHistory.storeId, stores.id))
    .where(eq(priceHistory.productId, id))
    .orderBy(desc(priceHistory.collectedAt))
    .limit(60);

  const productAlerts = await db
    .select()
    .from(alerts)
    .where(eq(alerts.productId, id))
    .orderBy(desc(alerts.createdAt))
    .limit(30);

  const productPurchases = await db
    .select()
    .from(purchases)
    .where(eq(purchases.productId, id))
    .orderBy(desc(purchases.purchasedAt))
    .limit(20);

  const [productRow] = await db.select().from(products).where(eq(products.id, id)).limit(1);

  const aviso = first(sp.aviso);
  const updateBound = updateProductAction.bind(null, id);
  const offerOptions = view.offers.map((o) => ({ id: o.id, label: `${o.storeName}${o.title ? ` — ${o.title.slice(0, 40)}` : ""}` }));

  return (
    <>
      <div className="mb-2 text-sm">
        <Link href="/produtos" className="text-indigo-600 hover:underline">← Produtos</Link>
      </div>
      <PageHeader
        title={view.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{[view.category, view.subcategory, view.brand, view.model].filter(Boolean).join(" · ")}</span>
            <Badge tone={view.priority === "alta" ? "danger" : view.priority === "media" ? "warning" : "neutral"}>Prioridade {PRIORITY_LABELS[view.priority]}</Badge>
            <Badge tone={view.status === "monitorando" ? "info" : view.status === "comprado" ? "success" : "neutral"}>{STATUS_LABELS[view.status]}</Badge>
          </span>
        }
        actions={
          <>
            <RunCollectionButton productId={id} label="Atualizar agora" />
          </>
        }
      />

      {aviso ? <div className="mb-4"><Notice tone="warning">{aviso}</Notice></div> : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <div className="space-y-4">
          <Card>
            <div className="flex flex-wrap items-start gap-4">
              {view.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={view.imageUrl} alt={view.name} className="h-28 w-28 rounded-lg bg-white object-contain ring-1 ring-slate-200" />
              ) : null}
              <div className="min-w-0 flex-1">
                <p className="text-xs uppercase tracking-wide text-slate-500">Preço atual (melhor oferta)</p>
                <p className="text-3xl font-semibold tabular-nums text-slate-900">{formatBRL(view.bestComparableCents)}</p>
                {view.best ? (
                  <p className="text-sm text-slate-600">
                    na <strong>{view.best.storeName}</strong> · {view.best.shippingKnown ? `frete ${formatBRL(view.best.shippingCents)}` : "frete desconhecido"} · atualizado {timeAgo(view.best.lastSuccessAt, now)}
                  </p>
                ) : (
                  <p className="text-sm text-slate-500">Nenhuma oferta com preço válido. Adicione uma oferta ou registre um preço.</p>
                )}
                {view.targetReached ? <div className="mt-2"><Badge tone="success">Atingiu o preço-alvo</Badge></div> : null}
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Menor observado (sistema)" value={formatBRL(view.minObservedCents)} hint={view.minObservedAt ? `em ${formatDate(view.minObservedAt)}` : "sem histórico"} tone="success" />
              <StatCard label="Maior observado" value={formatBRL(view.maxObservedCents)} />
              <StatCard label={`Média (${PERIOD_LABELS[period].toLowerCase()})`} value={formatBRL(summary.averageCents)} />
              <StatCard label="Variação no período" value={formatPercent(summary.variationPercent, true)} tone={summary.variationPercent !== null && summary.variationPercent < 0 ? "success" : summary.variationPercent && summary.variationPercent > 0 ? "danger" : "default"} hint="Do primeiro ao último ponto" />
            </div>
            <p className="mt-3 text-xs text-slate-500">
              “Menor observado” corresponde ao período efetivamente monitorado pelo Radar ({view.validHistoryCount} observação(ões) válida(s)), não necessariamente ao menor preço de todo o mercado.
            </p>
          </Card>

          <Card>
            <CardTitle
              action={
                <nav className="flex flex-wrap gap-1" aria-label="Período do gráfico">
                  {PERIOD_KEYS.map((k) => (
                    <Link
                      key={k}
                      href={`/produtos/${id}?periodo=${k}`}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium ${k === period ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                      aria-current={k === period ? "true" : undefined}
                    >
                      {k === "24h" ? "24 h" : k === "7d" ? "7 dias" : k === "30d" ? "30 dias" : k === "90d" ? "90 dias" : "Tudo"}
                    </Link>
                  ))}
                </nav>
              }
            >
              Histórico de preços · {PERIOD_LABELS[period]}
            </CardTitle>
            <PriceChart data={chartData} series={series} targetCents={view.targetPriceCents} referenceCents={view.referenceCents} />
            <p className="mt-2 text-xs text-slate-500">
              Valores comparáveis: preço + frete quando o frete é conhecido. Referência ({REFERENCE_LABELS[settings.referenceMode].toLowerCase()}): {formatBRL(view.referenceCents)}.
            </p>
            {perStore.length > 0 ? (
              <div className="table-wrap mt-4">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Loja</th>
                      <th className="py-2 pr-3 font-medium">Atual</th>
                      <th className="py-2 pr-3 font-medium">Menor</th>
                      <th className="py-2 pr-3 font-medium">Maior</th>
                      <th className="py-2 pr-3 font-medium">Média</th>
                      <th className="py-2 font-medium">Observações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {perStore.map((s) => (
                      <tr key={s.slug}>
                        <td className="py-2 pr-3 font-medium">{s.name}</td>
                        <td className="py-2 pr-3 tabular-nums">{formatBRL(s.summary.current?.priceCents)}</td>
                        <td className="py-2 pr-3 tabular-nums">{formatBRL(s.summary.min?.priceCents)}<span className="block text-xs text-slate-400">{formatDate(s.summary.min?.collectedAt)}</span></td>
                        <td className="py-2 pr-3 tabular-nums">{formatBRL(s.summary.max?.priceCents)}</td>
                        <td className="py-2 pr-3 tabular-nums">{formatBRL(s.summary.averageCents)}</td>
                        <td className="py-2 tabular-nums">{s.summary.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Card>

          <Card>
            <CardTitle>Comparação de ofertas</CardTitle>
            {view.offers.length === 0 ? (
              <EmptyState title="Nenhuma oferta cadastrada.">Adicione um link de loja abaixo.</EmptyState>
            ) : (
              <div className="space-y-3">
                {view.offers.map((o) => {
                  const diffBest = view.bestComparableCents !== null && o.comparableCents !== null ? o.comparableCents - view.bestComparableCents : null;
                  const diffPct = diffBest !== null && view.bestComparableCents ? (diffBest / view.bestComparableCents) * 100 : null;
                  const offerLogs = logs.filter((l) => l.storeName === o.storeName).length;
                  return (
                    <div key={o.id} className={`rounded-lg border p-3 ${o.isActive ? "border-slate-200" : "border-dashed border-slate-300 bg-slate-50 opacity-75"}`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-slate-900">
                            {o.storeName}{" "}
                            {o.source === "demo" ? <Badge tone="demo">DEMO</Badge> : null}{" "}
                            {!o.isActive ? <Badge>desativada</Badge> : null}
                          </p>
                          {o.title ? <p className="truncate text-xs text-slate-500">{o.title}</p> : null}
                          <a href={o.url} target="_blank" rel="noopener noreferrer nofollow" className="text-xs text-indigo-600 hover:underline">
                            Abrir oferta ↗
                          </a>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-semibold tabular-nums">{formatBRL(o.priceCents)}</p>
                          <p className="text-xs text-slate-500">
                            frete {o.shippingKnown ? formatBRL(o.shippingCents) : "desconhecido"} · total {o.shippingKnown ? formatBRL(o.comparableCents) : "—"}
                          </p>
                          {diffBest !== null && diffBest > 0 ? (
                            <p className="text-xs text-rose-700">+{formatBRL(diffBest)} (+{formatPercent(diffPct)}) vs. melhor</p>
                          ) : diffBest === 0 ? (
                            <p className="text-xs font-medium text-emerald-700">Melhor oferta</p>
                          ) : null}
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
                        <Badge tone={o.availability === "disponivel" ? "success" : o.availability === "indisponivel" ? "danger" : "neutral"}>{AVAILABILITY_LABELS[o.availability]}</Badge>
                        <Badge tone={o.matchStatus === "confirmado" ? "success" : o.matchStatus === "divergente" ? "danger" : "warning"}>Correspondência: {MATCH_LABELS[o.matchStatus]}</Badge>
                        <Badge tone={o.confidence.level === "alta" ? "success" : o.confidence.level === "media" ? "warning" : "danger"}>Confiança: {CONFIDENCE_LABEL[o.confidence.level]}</Badge>
                        <span className="text-slate-500">Última coleta: {formatDateTime(o.lastSuccessAt)}</span>
                        {o.stale ? <Badge tone="warning">desatualizado</Badge> : null}
                        {o.consecutiveFailures > 0 ? <Badge tone="danger">{o.consecutiveFailures} falha(s)</Badge> : null}
                        {o.storeIntegrationMode !== "api" ? <Badge>atualização manual</Badge> : null}
                      </div>
                      <details className="mt-2 text-xs text-slate-600">
                        <summary className="cursor-pointer text-slate-500 hover:text-slate-800">Por que esta confiança? ({o.confidence.score}/100)</summary>
                        <ul className="mt-1 list-disc space-y-0.5 pl-5">
                          {o.confidence.reasons.map((r) => (
                            <li key={r}>{r}</li>
                          ))}
                        </ul>
                        {o.matchNotes ? <p className="mt-1">Correspondência: {o.matchNotes}</p> : null}
                        {o.lastError ? <p className="mt-1 text-rose-700">Último erro: {o.lastError}</p> : null}
                        {offerLogs > 0 ? <p className="mt-1 text-slate-400">{offerLogs} registro(s) recentes nesta loja.</p> : null}
                      </details>
                      <div className="mt-3 flex flex-wrap items-start gap-2">
                        {o.isActive && o.storeIntegrationMode !== "api" ? (
                          <details className="w-full sm:w-auto">
                            <summary className={`${btnSecondary} cursor-pointer list-none`}>Registrar preço manualmente</summary>
                            <div className="mt-2 w-full min-w-[280px] rounded-lg border border-slate-200 bg-slate-50 p-3">
                              <ManualPriceForm offerId={o.id} productId={id} action={registerManualPriceAction} />
                            </div>
                          </details>
                        ) : null}
                        {o.matchStatus !== "confirmado" ? (
                          <form action={setOfferMatchAction}>
                            <input type="hidden" name="offerId" value={o.id} />
                            <input type="hidden" name="productId" value={id} />
                            <input type="hidden" name="status" value="confirmado" />
                            <button type="submit" className={btnSecondary}>Confirmar mesmo produto</button>
                          </form>
                        ) : null}
                        {o.matchStatus !== "divergente" ? (
                          <form action={setOfferMatchAction}>
                            <input type="hidden" name="offerId" value={o.id} />
                            <input type="hidden" name="productId" value={id} />
                            <input type="hidden" name="status" value="divergente" />
                            <button type="submit" className={btnSecondary}>Marcar como outro produto</button>
                          </form>
                        ) : null}
                        <form action={toggleOfferAction}>
                          <input type="hidden" name="offerId" value={o.id} />
                          <input type="hidden" name="productId" value={id} />
                          <input type="hidden" name="active" value={o.isActive ? "0" : "1"} />
                          <button type="submit" className={btnSecondary}>{o.isActive ? "Desativar oferta" : "Reativar oferta"}</button>
                        </form>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="mt-5 border-t border-slate-200 pt-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-800">Adicionar oferta de outra loja</h3>
              <OfferAddForm productId={id} action={addOfferAction} />
            </div>
          </Card>

          <Card>
            <CardTitle>Alertas deste produto</CardTitle>
            {productAlerts.length === 0 ? (
              <EmptyState title="Nenhum alerta para este produto ainda." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {productAlerts.map((a) => (
                  <li key={a.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">{a.title}</p>
                      <p className="text-xs text-slate-500">
                        {ALERT_LABELS[a.type as keyof typeof ALERT_LABELS]} · {formatDateTime(a.createdAt)} · {a.message}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge tone={a.status === "nao_lido" ? "danger" : "neutral"}>{a.status === "nao_lido" ? "não lido" : a.status === "lido" ? "lido" : "arquivado"}</Badge>
                      {a.status === "nao_lido" ? (
                        <form action={setAlertStatusAction}>
                          <input type="hidden" name="id" value={a.id} />
                          <input type="hidden" name="status" value="lido" />
                          <button className="text-xs text-indigo-600 hover:underline">Marcar lido</button>
                        </form>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardTitle>Registros de coleta</CardTitle>
            <p className="mb-3 text-xs text-slate-500">Cada consulta (automática, manual ou registro de preço) fica registrada, inclusive as falhas.</p>
            {logs.length === 0 ? (
              <EmptyState title="Nenhum registro de coleta ainda." />
            ) : (
              <div className="table-wrap">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Data/hora</th>
                      <th className="py-2 pr-3 font-medium">Loja</th>
                      <th className="py-2 pr-3 font-medium">Resultado</th>
                      <th className="py-2 pr-3 font-medium">Preço</th>
                      <th className="py-2 pr-3 font-medium">Frete</th>
                      <th className="py-2 pr-3 font-medium">Disponibilidade</th>
                      <th className="py-2 font-medium">Origem</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {logs.map((l) => (
                      <tr key={l.id}>
                        <td className="py-2 pr-3 whitespace-nowrap">{formatDateTime(l.collectedAt)}</td>
                        <td className="py-2 pr-3">{l.storeName}</td>
                        <td className="py-2 pr-3">
                          {l.status === "sucesso" ? <Badge tone="success">sucesso</Badge> : <Badge tone="danger">erro</Badge>}
                          {l.errorMessage ? <span className="mt-1 block max-w-xs text-xs text-rose-700">{l.errorMessage}</span> : null}
                        </td>
                        <td className="py-2 pr-3 tabular-nums">{formatBRL(l.priceCents)}</td>
                        <td className="py-2 pr-3 tabular-nums">{l.shippingKnown ? formatBRL(l.shippingCents) : "—"}</td>
                        <td className="py-2 pr-3">{AVAILABILITY_LABELS[l.availability]}</td>
                        <td className="py-2 text-xs text-slate-500">{l.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <aside className="space-y-4">
          <Card>
            <CardTitle>Metas</CardTitle>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-slate-500">Preço-alvo</dt><dd className="font-medium tabular-nums">{formatBRL(view.targetPriceCents)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Orçamento máximo</dt><dd className="font-medium tabular-nums">{formatBRL(view.maxBudgetCents)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Referência</dt><dd className="font-medium tabular-nums">{formatBRL(view.referenceCents)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Economia potencial</dt><dd className="font-medium tabular-nums text-indigo-700">{formatBRL(view.savingCents)}</dd></div>
              <div className="flex justify-between"><dt className="text-slate-500">Dentro do orçamento</dt><dd>{view.budgetReached ? "Sim" : "Não"}</dd></div>
            </dl>
            <p className="mt-3 text-xs text-slate-500">Economia potencial = referência − melhor preço atual. Ainda não é economia realizada.</p>
          </Card>

          <Card>
            <CardTitle>Registrar compra</CardTitle>
            <PurchaseForm productId={id} offers={offerOptions} action={registerPurchaseAction} />
            {productPurchases.length > 0 ? (
              <ul className="mt-4 divide-y divide-slate-100 text-sm">
                {productPurchases.map((p) => (
                  <li key={p.id} className="py-2">
                    <p>{p.quantity}× a {formatBRL(p.paidUnitCents)} + frete {formatBRL(p.paidShippingCents)}</p>
                    <p className="text-xs text-slate-500">
                      {formatDate(p.purchasedAt)} · economia realizada: {p.realizedSavingCents === null ? "sem referência" : <span className="font-medium text-emerald-700">{formatBRL(p.realizedSavingCents)}</span>}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>

          <Card>
            <CardTitle>Status</CardTitle>
            <form action={setProductStatusAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="productId" value={id} />
              <select name="status" defaultValue={view.status} className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm">
                {Object.entries(STATUS_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
              <button type="submit" className={btnSecondary}>Salvar status</button>
            </form>
          </Card>

          <Card>
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-slate-800">Editar produto</summary>
              <div className="mt-4">
                <ProductForm
                  action={updateBound}
                  mode="edit"
                  submitLabel="Salvar alterações"
                  initial={{
                    name: view.name,
                    category: view.category,
                    subcategory: view.subcategory ?? "",
                    brand: view.brand ?? "",
                    model: view.model ?? "",
                    manufacturerCode: view.manufacturerCode ?? "",
                    gtin: view.gtin ?? "",
                    imageUrl: view.imageUrl ?? "",
                    referenceUrl: view.referenceUrl ?? "",
                    targetPriceCents: centsToInput(view.targetPriceCents),
                    maxBudgetCents: centsToInput(view.maxBudgetCents),
                    referencePriceCents: centsToInput(view.referencePriceCents),
                    notes: view.notes ?? "",
                    priority: view.priority,
                    status: view.status,
                  }}
                />
              </div>
            </details>
          </Card>

          <Card>
            <CardTitle>Identificação</CardTitle>
            <p className="text-xs text-slate-600">Atualizado {formatDateTime(view.updatedAt)} · criado {formatDate(view.createdAt)}</p>
            {productRow?.notes ? <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{productRow.notes}</p> : null}
            <p className="mt-2 text-xs text-slate-500">Confiança e correspondência são calculadas por oferta; nomes semelhantes não confirmam o mesmo produto.</p>
          </Card>
        </aside>
      </div>
    </>
  );
}
