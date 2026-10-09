import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { getDb } from "@/db/client";
import { loadSettings } from "@/lib/repos/settings-repo";
import { loadCatalog, type ProductView } from "@/lib/repos/catalog";
import { queryProducts, type SortKey } from "@/lib/analysis/product-query";
import { parseMoneyToCents, formatBRL, formatPercent } from "@/lib/money";
import { formatDateTime, timeAgo } from "@/lib/format";
import { CATEGORIES, PRIORITY_LABELS, STATUS_LABELS } from "@/lib/constants";
import { Badge, btnPrimary, Card, EmptyState, inputCls, labelCls, PageHeader, Pagination } from "@/components/ui";
import { STORE_CATALOG } from "@/lib/stores-catalog";
import { REFERENCE_LABELS } from "@/lib/analysis/references";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const SORTS: { value: SortKey; label: string }[] = [
  { value: "nome", label: "Nome" },
  { value: "prioridade", label: "Prioridade" },
  { value: "melhor_preco", label: "Melhor preço" },
  { value: "economia", label: "Economia potencial" },
  { value: "queda", label: "Queda recente" },
  { value: "atualizacao", label: "Atualização" },
];

const PRIORITY_TONE: Record<string, "danger" | "warning" | "neutral"> = { alta: "danger", media: "warning", baixa: "neutral" };

function BestOfferCell({ p }: { p: ProductView }) {
  if (!p.best) return <span className="text-slate-400">Sem preço</span>;
  return (
    <div>
      <p className="font-semibold tabular-nums text-slate-900">{formatBRL(p.best.comparableCents)}</p>
      <p className="text-xs text-slate-500">
        {p.best.storeName}
        {p.best.shippingKnown ? "" : " · frete?"}
      </p>
    </div>
  );
}

export default async function ProdutosPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireUser();
  const sp = await searchParams;
  const now = new Date();
  const db = getDb();
  const settings = await loadSettings(db);
  const statusParam = first(sp.status);
  const views = await loadCatalog(db, {
    now,
    settings,
    filter: { includeArchived: statusParam === "arquivado" || statusParam === "todos" },
  });

  const sort = (SORTS.map((s) => s.value) as string[]).includes(first(sp.ordenar)) ? (first(sp.ordenar) as SortKey) : "nome";
  const dir = first(sp.direcao) === "desc" ? "desc" : "asc";
  const page = Math.max(1, Number(first(sp.pagina)) || 1);
  const result = queryProducts(views, {
    q: first(sp.q),
    category: first(sp.categoria),
    store: first(sp.loja),
    priority: first(sp.prioridade),
    status: statusParam || undefined,
    minPriceCents: parseMoneyToCents(first(sp.preco_min)),
    maxPriceCents: parseMoneyToCents(first(sp.preco_max)),
    sort,
    dir,
    page,
    pageSize: 20,
  });

  const params: Record<string, string | undefined> = {
    q: first(sp.q) || undefined,
    categoria: first(sp.categoria) || undefined,
    loja: first(sp.loja) || undefined,
    prioridade: first(sp.prioridade) || undefined,
    status: statusParam || undefined,
    preco_min: first(sp.preco_min) || undefined,
    preco_max: first(sp.preco_max) || undefined,
    ordenar: sort,
    direcao: dir,
  };

  return (
    <>
      <PageHeader
        title="Produtos"
        subtitle={`${result.total} produto(s) encontrado(s). Economia calculada com: ${REFERENCE_LABELS[settings.referenceMode].toLowerCase()}.`}
        actions={
          <Link href="/produtos/novo" className={btnPrimary}>
            + Novo produto
          </Link>
        }
      />

      <Card className="mb-4">
        <form method="GET" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-2">
            <label htmlFor="q" className={labelCls}>Buscar</label>
            <input id="q" name="q" defaultValue={first(sp.q)} placeholder="Nome, marca, modelo, GTIN…" className={inputCls} />
          </div>
          <div>
            <label htmlFor="categoria" className={labelCls}>Categoria</label>
            <select id="categoria" name="categoria" defaultValue={first(sp.categoria)} className={inputCls}>
              <option value="">Todas</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="loja" className={labelCls}>Loja</label>
            <select id="loja" name="loja" defaultValue={first(sp.loja)} className={inputCls}>
              <option value="">Todas</option>
              {STORE_CATALOG.filter((s) => s.adapterKey || s.slug === "outra-loja").map((s) => (
                <option key={s.slug} value={s.slug}>{s.name}</option>
              ))}
              {STORE_CATALOG.filter((s) => !s.adapterKey && s.slug !== "outra-loja").map((s) => (
                <option key={s.slug} value={s.slug}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="prioridade" className={labelCls}>Prioridade</label>
            <select id="prioridade" name="prioridade" defaultValue={first(sp.prioridade)} className={inputCls}>
              <option value="">Todas</option>
              {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="status" className={labelCls}>Status</label>
            <select id="status" name="status" defaultValue={statusParam} className={inputCls}>
              <option value="">Ativos (exceto arquivados)</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
              <option value="todos">Todos, inclusive arquivados</option>
            </select>
          </div>
          <div>
            <label htmlFor="preco_min" className={labelCls}>Preço mínimo (R$)</label>
            <input id="preco_min" name="preco_min" inputMode="decimal" defaultValue={first(sp.preco_min)} className={inputCls} />
          </div>
          <div>
            <label htmlFor="preco_max" className={labelCls}>Preço máximo (R$)</label>
            <input id="preco_max" name="preco_max" inputMode="decimal" defaultValue={first(sp.preco_max)} className={inputCls} />
          </div>
          <div>
            <label htmlFor="ordenar" className={labelCls}>Ordenar por</label>
            <select id="ordenar" name="ordenar" defaultValue={sort} className={inputCls}>
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="direcao" className={labelCls}>Direção</label>
            <select id="direcao" name="direcao" defaultValue={dir} className={inputCls}>
              <option value="asc">Crescente</option>
              <option value="desc">Decrescente</option>
            </select>
          </div>
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
            <button type="submit" className={btnPrimary}>Aplicar filtros</button>
            <Link href="/produtos" className="inline-flex items-center rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">Limpar</Link>
          </div>
        </form>
      </Card>

      {result.items.length === 0 ? (
        <EmptyState title="Nenhum produto encontrado.">
          {views.length === 0 ? (
            <>Cadastre seu primeiro produto em <Link className="text-indigo-600 hover:underline" href="/produtos/novo">Novo produto</Link>.</>
          ) : (
            "Ajuste os filtros ou a busca."
          )}
        </EmptyState>
      ) : (
        <>
          {/* Visão em tabela (desktop) */}
          <Card className="hidden p-0 md:block">
            <div className="table-wrap">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Produto</th>
                    <th className="px-4 py-3 font-medium">Categoria</th>
                    <th className="px-4 py-3 font-medium">Melhor preço</th>
                    <th className="px-4 py-3 font-medium">Alvo / orçamento</th>
                    <th className="px-4 py-3 font-medium">Economia</th>
                    <th className="px-4 py-3 font-medium">Queda</th>
                    <th className="px-4 py-3 font-medium">Atualização</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {result.items.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          {p.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={p.imageUrl} alt="" className="h-10 w-10 shrink-0 rounded-md object-contain ring-1 ring-slate-200" loading="lazy" />
                          ) : (
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs text-slate-400">sem foto</div>
                          )}
                          <div className="min-w-0">
                            <Link href={`/produtos/${p.id}`} className="block truncate font-medium text-slate-900 hover:text-indigo-700">{p.name}</Link>
                            <p className="truncate text-xs text-slate-500">{[p.brand, p.model].filter(Boolean).join(" · ") || "—"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{p.category}{p.subcategory ? <span className="block text-xs text-slate-400">{p.subcategory}</span> : null}</td>
                      <td className="px-4 py-3"><BestOfferCell p={p} /></td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        <span className={p.targetReached ? "font-semibold text-emerald-700" : ""}>Alvo {formatBRL(p.targetPriceCents)}</span>
                        <br />
                        Orç. {formatBRL(p.maxBudgetCents)}
                      </td>
                      <td className="px-4 py-3 tabular-nums">{p.savingCents ? <span className="text-indigo-700">{formatBRL(p.savingCents)}</span> : "—"}</td>
                      <td className="px-4 py-3">{p.dropPercent && p.dropPercent > 0 ? <Badge tone="warning">−{formatPercent(p.dropPercent)}</Badge> : "—"}</td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {timeAgo(p.lastCollectedAt, now)}
                        {p.staleOffers > 0 ? <span className="block text-amber-700">{p.staleOffers} desatualizada(s)</span> : null}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-start gap-1">
                          <Badge tone={PRIORITY_TONE[p.priority]}>{PRIORITY_LABELS[p.priority]}</Badge>
                          <span className="text-xs text-slate-500">{STATUS_LABELS[p.status]}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Visão em cartões (celular) */}
          <ul className="space-y-3 md:hidden">
            {result.items.map((p) => (
              <li key={p.id}>
                <Link href={`/produtos/${p.id}`} className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm active:bg-slate-50">
                  <div className="flex items-start gap-3">
                    {p.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.imageUrl} alt="" className="h-14 w-14 shrink-0 rounded-md object-contain ring-1 ring-slate-200" loading="lazy" />
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-900">{p.name}</p>
                      <p className="truncate text-xs text-slate-500">{p.category} · {[p.brand, p.model].filter(Boolean).join(" · ") || "sem marca/modelo"}</p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-end justify-between gap-2">
                    <BestOfferCell p={p} />
                    <div className="flex flex-wrap justify-end gap-1">
                      <Badge tone={PRIORITY_TONE[p.priority]}>{PRIORITY_LABELS[p.priority]}</Badge>
                      {p.targetReached ? <Badge tone="success">Atingiu o alvo</Badge> : null}
                      {p.dropPercent && p.dropPercent > 0 ? <Badge tone="warning">−{formatPercent(p.dropPercent)}</Badge> : null}
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">Atualizado {formatDateTime(p.lastCollectedAt)} · {STATUS_LABELS[p.status]}</p>
                </Link>
              </li>
            ))}
          </ul>

          <Pagination basePath="/produtos" params={params} page={result.page} totalPages={result.totalPages} />
        </>
      )}
    </>
  );
}
