"use client";

import { useActionState } from "react";
import { initialState, type ActionState } from "@/lib/action-state";
import type { FormAction } from "./form-with-state";
import { Notice } from "./ui";
import { formatBRL } from "@/lib/money";

interface CandidateView {
  externalId: string;
  title: string | null;
  priceCents: number | null;
  permalink: string | null;
  imageUrl: string | null;
  freeShipping: boolean;
  sellerName: string | null;
  match: { status: "confirmado" | "pendente" | "divergente"; reasons: string[] };
  alreadyAdded: boolean;
}

/** Formulário de adição de um candidato encontrado (uma ação por linha, estado próprio). */
function AddCandidateForm({ productId, url, addAction }: { productId: string; url: string; addAction: FormAction }) {
  const [state, formAction, pending] = useActionState(addAction, initialState);
  return (
    <form action={formAction} className="space-y-1">
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="url" value={url} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
      >
        {pending ? "Adicionando…" : "Adicionar como oferta"}
      </button>
      {state.message ? (
        <p className={`text-xs ${state.ok ? "text-emerald-700" : "text-rose-700"}`}>{state.message}</p>
      ) : null}
    </form>
  );
}

const MATCH_TONE: Record<CandidateView["match"]["status"], string> = {
  confirmado: "bg-emerald-100 text-emerald-800",
  pendente: "bg-amber-100 text-amber-800",
  divergente: "bg-rose-100 text-rose-800",
};
const MATCH_LABEL: Record<CandidateView["match"]["status"], string> = {
  confirmado: "Correspondência confirmada",
  pendente: "Revisar correspondência",
  divergente: "Provável outro produto",
};

/**
 * Painel de busca de ofertas no Mercado Livre (API oficial de busca).
 * A busca roda no servidor via server action; os resultados voltam no estado da ação.
 */
export function OfferSearchPanel({ productId, action, addAction }: { productId: string; action: FormAction; addAction: FormAction }) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const candidates = (state.data?.candidates as CandidateView[] | undefined) ?? null;
  const query = (state.data?.query as string | undefined) ?? "";
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="productId" value={productId} />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
        >
          {pending ? "Buscando…" : "Buscar ofertas no Mercado Livre"}
        </button>
        <p className="text-xs text-slate-500">
          Usa a busca oficial (GET /sites/MLB/search) com o nome/marca/modelo do produto. Outras lojas entram por link.
        </p>
      </div>
      {state.message && candidates === null ? <Notice tone={state.ok ? "success" : "error"}>{state.message}</Notice> : null}
      {candidates !== null && candidates.length === 0 ? (
        <Notice tone={state.ok ? "info" : "error"}>{state.message}</Notice>
      ) : null}
      {candidates && candidates.length > 0 ? (
        <div className="space-y-2">
          <Notice tone="success">{state.message}</Notice>
          {query ? <p className="text-xs text-slate-500">Consulta enviada: “{query}”</p> : null}
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {candidates.map((c) => (
              <li key={c.externalId} className="flex flex-wrap items-start gap-3 p-3">
                {c.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.imageUrl} alt="" className="h-12 w-12 rounded object-contain" />
                ) : (
                  <div className="h-12 w-12 rounded bg-slate-100" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-slate-900">{c.title ?? c.externalId}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="font-semibold tabular-nums">{c.priceCents !== null ? formatBRL(c.priceCents) : "preço não informado"}</span>
                    <span className="text-slate-500">{c.freeShipping ? "· frete grátis" : "· frete não informado"}</span>
                    {c.sellerName ? <span className="text-slate-500">· {c.sellerName}</span> : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className={`rounded px-1.5 py-0.5 font-medium ${MATCH_TONE[c.match.status]}`} title={c.match.reasons.join("; ")}>
                      {MATCH_LABEL[c.match.status]}
                    </span>
                    {c.permalink ? (
                      <a href={c.permalink} target="_blank" rel="noopener noreferrer nofollow" className="text-indigo-600 hover:underline">
                        Ver anúncio ↗
                      </a>
                    ) : null}
                  </div>
                </div>
                <div className="shrink-0">
                  {c.alreadyAdded ? (
                    <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">Já cadastrada</span>
                  ) : c.permalink ? (
                    <AddCandidateForm productId={productId} url={c.permalink} addAction={addAction} />
                  ) : (
                    <span className="text-xs text-slate-400">sem link</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </form>
  );
}
