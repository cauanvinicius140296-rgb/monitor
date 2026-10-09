"use client";

import { useState, useTransition } from "react";
import { useActionState } from "react";
import { identifyUrlAction } from "@/app/actions/products";
import { initialState, type ActionState } from "@/lib/action-state";
import { CATEGORIES, PRIORITY_LABELS, STATUS_LABELS } from "@/lib/constants";
import { Field, inputCls, Notice, btnSecondary } from "./ui";
import { centsToInput } from "@/lib/money";

export interface ProductFormValues {
  name: string;
  category: string;
  subcategory: string;
  brand: string;
  model: string;
  manufacturerCode: string;
  gtin: string;
  imageUrl: string;
  referenceUrl: string;
  targetPriceCents: string;
  maxBudgetCents: string;
  referencePriceCents: string;
  notes: string;
  priority: string;
  status: string;
}

const EMPTY: ProductFormValues = {
  name: "",
  category: "Outros",
  subcategory: "",
  brand: "",
  model: "",
  manufacturerCode: "",
  gtin: "",
  imageUrl: "",
  referenceUrl: "",
  targetPriceCents: "",
  maxBudgetCents: "",
  referencePriceCents: "",
  notes: "",
  priority: "media",
  status: "monitorando",
};


type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function ProductForm({
  action,
  initial,
  mode,
  submitLabel,
  showOffer = false,
}: {
  action: Action;
  initial?: Partial<ProductFormValues>;
  mode: "create" | "edit";
  submitLabel: string;
  showOffer?: boolean;
}) {
  const [values, setValues] = useState<ProductFormValues>({ ...EMPTY, ...initial });
  const [offer, setOffer] = useState({ url: "", price: "", shipping: "", availability: "desconhecido", shippingKnown: false });
  const [identifyMsg, setIdentifyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [identifying, startIdentify] = useTransition();
  const [state, formAction, pending] = useActionState(action, initialState);
  const errors = state.errors ?? {};

  const set = (k: keyof ProductFormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  function identify() {
    const url = offer.url.trim() || values.referenceUrl.trim();
    if (!url) {
      setIdentifyMsg({ ok: false, text: "Cole o link do anúncio para identificar." });
      return;
    }
    startIdentify(async () => {
      const r = await identifyUrlAction(url);
      setIdentifyMsg({ ok: r.ok, text: r.message ?? "" });
      if (!r.ok || !r.data) return;
      const d = r.data as Record<string, unknown>;
      setValues((v) => ({
        ...v,
        name: v.name || (typeof d.title === "string" ? d.title : v.name),
        brand: v.brand || (typeof d.brand === "string" ? d.brand : v.brand),
        model: v.model || (typeof d.model === "string" ? d.model : v.model),
        gtin: v.gtin || (typeof d.gtin === "string" ? d.gtin : v.gtin),
        imageUrl: v.imageUrl || (typeof d.imageUrl === "string" ? d.imageUrl : v.imageUrl),
        referenceUrl: v.referenceUrl || (typeof d.canonicalUrl === "string" ? d.canonicalUrl : v.referenceUrl),
      }));
      setOffer((o) => ({
        ...o,
        url: typeof d.canonicalUrl === "string" ? d.canonicalUrl : o.url,
        price: typeof d.priceCents === "number" ? centsToInput(d.priceCents) : o.price,
        shipping: typeof d.shippingCents === "number" ? centsToInput(d.shippingCents) : o.shipping,
        shippingKnown: Boolean(d.shippingKnown),
        availability: typeof d.availability === "string" ? d.availability : o.availability,
      }));
    });
  }

  return (
    <form action={formAction} className="space-y-6">
      {showOffer ? (
        <fieldset className="space-y-4 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
          <legend className="px-1 text-sm font-semibold text-indigo-800">Oferta inicial (opcional)</legend>
          <p className="text-xs text-slate-600">
            Cole o link de uma loja e clique em “Identificar”. Para Mercado Livre, nome, imagem, preço, marca, modelo e GTIN são preenchidos
            automaticamente quando a API responde. Em outras lojas, preencha manualmente.
          </p>
          <Field label="Link do anúncio" name="offerUrl" error={errors.offerUrl}>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="offerUrl"
                name="offerUrl"
                type="url"
                inputMode="url"
                placeholder="https://produto.mercadolivre.com.br/MLB-…"
                value={offer.url}
                onChange={(e) => setOffer((o) => ({ ...o, url: e.target.value }))}
                className={inputCls}
              />
              <button type="button" onClick={identify} disabled={identifying} className={`${btnSecondary} shrink-0`}>
                {identifying ? "Identificando…" : "Identificar"}
              </button>
            </div>
          </Field>
          {identifyMsg ? <Notice tone={identifyMsg.ok ? "info" : "warning"}>{identifyMsg.text}</Notice> : null}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Preço (R$)" name="offerPriceCents" error={errors.offerPriceCents}>
              <input id="offerPriceCents" name="offerPriceCents" inputMode="decimal" placeholder="1.299,90" value={offer.price} onChange={(e) => setOffer((o) => ({ ...o, price: e.target.value }))} className={inputCls} />
            </Field>
            <Field label="Frete (R$)" name="offerShippingCents" hint="Vazio = frete desconhecido">
              <input id="offerShippingCents" name="offerShippingCents" inputMode="decimal" placeholder="0,00" value={offer.shipping} onChange={(e) => setOffer((o) => ({ ...o, shipping: e.target.value }))} className={inputCls} />
            </Field>
            <Field label="Disponibilidade" name="offerAvailability">
              <select id="offerAvailability" name="offerAvailability" value={offer.availability} onChange={(e) => setOffer((o) => ({ ...o, availability: e.target.value }))} className={inputCls}>
                <option value="desconhecido">Desconhecida</option>
                <option value="disponivel">Disponível</option>
                <option value="indisponivel">Indisponível</option>
              </select>
            </Field>
          </div>
        </fieldset>
      ) : null}

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="sr-only">Dados do produto</legend>
        <Field label="Nome do produto *" name="name" error={errors.name} className="sm:col-span-2">
          <input id="name" name="name" required value={values.name} onChange={set("name")} className={inputCls} maxLength={240} />
        </Field>
        <Field label="Categoria *" name="category" error={errors.category}>
          <select id="category" name="category" value={values.category} onChange={set("category")} className={inputCls}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Subcategoria" name="subcategory" error={errors.subcategory}>
          <input id="subcategory" name="subcategory" value={values.subcategory} onChange={set("subcategory")} className={inputCls} placeholder="Ex.: Geladeira frost free" maxLength={80} />
        </Field>
        <Field label="Marca" name="brand" error={errors.brand}>
          <input id="brand" name="brand" value={values.brand} onChange={set("brand")} className={inputCls} maxLength={120} />
        </Field>
        <Field label="Modelo" name="model" error={errors.model}>
          <input id="model" name="model" value={values.model} onChange={set("model")} className={inputCls} maxLength={160} />
        </Field>
        <Field label="Código do fabricante" name="manufacturerCode" error={errors.manufacturerCode} hint="SKU ou part number exato">
          <input id="manufacturerCode" name="manufacturerCode" value={values.manufacturerCode} onChange={set("manufacturerCode")} className={inputCls} maxLength={120} />
        </Field>
        <Field label="GTIN/EAN" name="gtin" error={errors.gtin} hint="8, 12, 13 ou 14 dígitos (opcional)">
          <input id="gtin" name="gtin" inputMode="numeric" value={values.gtin} onChange={set("gtin")} className={inputCls} />
        </Field>
        <Field label="URL da imagem" name="imageUrl" error={errors.imageUrl}>
          <input id="imageUrl" name="imageUrl" type="url" value={values.imageUrl} onChange={set("imageUrl")} className={inputCls} />
        </Field>
        <Field label="URL de referência" name="referenceUrl" error={errors.referenceUrl} hint="Página de referência do produto">
          <input id="referenceUrl" name="referenceUrl" type="url" value={values.referenceUrl} onChange={set("referenceUrl")} className={inputCls} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-slate-800">Metas e referências (R$)</legend>
        <Field label="Preço-alvo" name="targetPriceCents" error={errors.targetPriceCents} hint="Alerta ao atingir este valor">
          <input id="targetPriceCents" name="targetPriceCents" inputMode="decimal" value={values.targetPriceCents} onChange={set("targetPriceCents")} className={inputCls} placeholder="0,00" />
        </Field>
        <Field label="Orçamento máximo" name="maxBudgetCents" error={errors.maxBudgetCents}>
          <input id="maxBudgetCents" name="maxBudgetCents" inputMode="decimal" value={values.maxBudgetCents} onChange={set("maxBudgetCents")} className={inputCls} placeholder="0,00" />
        </Field>
        <Field label="Preço de referência" name="referencePriceCents" error={errors.referencePriceCents} hint="Preço “normal” para calcular economia">
          <input id="referencePriceCents" name="referencePriceCents" inputMode="decimal" value={values.referencePriceCents} onChange={set("referencePriceCents")} className={inputCls} placeholder="0,00" />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="sr-only">Acompanhamento</legend>
        <Field label="Prioridade de compra" name="priority" error={errors.priority}>
          <select id="priority" name="priority" value={values.priority} onChange={set("priority")} className={inputCls}>
            {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status" name="status" error={errors.status}>
          <select id="status" name="status" value={values.status} onChange={set("status")} className={inputCls}>
            {Object.entries(STATUS_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <div />
        <Field label="Observações pessoais" name="notes" error={errors.notes} className="sm:col-span-3">
          <textarea id="notes" name="notes" rows={3} value={values.notes} onChange={set("notes")} className={inputCls} maxLength={2000} />
        </Field>
      </fieldset>

      {errors.duplicate ? (
        <label className="flex items-center gap-2 text-sm text-amber-800">
          <input type="checkbox" name="confirmDuplicate" value="1" className="h-4 w-4 rounded border-slate-300" />
          Confirmo que este é outro produto e quero cadastrá-lo mesmo assim.
        </label>
      ) : null}

      {state.message ? <Notice tone={state.ok ? "success" : "error"}>{state.message}</Notice> : null}

      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className="inline-flex items-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60">
          {pending ? "Salvando…" : submitLabel}
        </button>
        {mode === "create" ? <span className="self-center text-xs text-slate-500">Campos marcados com * são obrigatórios.</span> : null}
      </div>
    </form>
  );
}
