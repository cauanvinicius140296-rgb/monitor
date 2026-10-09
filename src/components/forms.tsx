"use client";

import { FormWithState, type FormAction } from "./form-with-state";
import { Field, inputCls } from "./ui";
import { AVAILABILITY_LABELS, ROOMS } from "@/lib/constants";

const AVAILABILITY_OPTIONS = ["desconhecido", "disponivel", "indisponivel"] as const;

function AvailabilitySelect({ defaultValue = "desconhecido" }: { defaultValue?: string }) {
  return (
    <select name="availability" defaultValue={defaultValue} className={inputCls}>
      {AVAILABILITY_OPTIONS.map((a) => (
        <option key={a} value={a}>
          {AVAILABILITY_LABELS[a]}
        </option>
      ))}
    </select>
  );
}

/** Adiciona uma oferta (loja) a um produto existente, a partir de URL e preço opcional. */
export function OfferAddForm({ productId, action }: { productId: string; action: FormAction }) {
  return (
    <FormWithState action={action} submitLabel="Adicionar oferta" resetOnSuccess>
      <input type="hidden" name="productId" value={productId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Link do anúncio *" name="url" className="sm:col-span-2">
          <input name="url" type="url" required placeholder="https://…" className={inputCls} />
        </Field>
        <Field label="Preço (R$)" name="priceCents" hint="Opcional: pode ser registrado depois">
          <input name="priceCents" inputMode="decimal" placeholder="0,00" className={inputCls} />
        </Field>
        <Field label="Frete (R$)" name="shippingCents" hint="Vazio = frete desconhecido">
          <input name="shippingCents" inputMode="decimal" placeholder="0,00" className={inputCls} />
        </Field>
        <Field label="Disponibilidade" name="availability">
          <AvailabilitySelect />
        </Field>
      </div>
    </FormWithState>
  );
}

/** Registro manual de preço de uma oferta (lojas sem integração automática). */
export function ManualPriceForm({ offerId, productId, action }: { offerId: string; productId: string; action: FormAction }) {
  return (
    <FormWithState action={action} submitLabel="Registrar preço" buttonClassName="inline-flex rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700">
      <input type="hidden" name="offerId" value={offerId} />
      <input type="hidden" name="productId" value={productId} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Preço (R$) *" name="priceCents">
          <input name="priceCents" required inputMode="decimal" placeholder="0,00" className={inputCls} />
        </Field>
        <Field label="Frete (R$)" name="shippingCents" hint="Vazio = desconhecido">
          <input name="shippingCents" inputMode="decimal" placeholder="0,00" className={inputCls} />
        </Field>
        <Field label="Disponibilidade" name="availability">
          <AvailabilitySelect defaultValue="disponivel" />
        </Field>
      </div>
    </FormWithState>
  );
}

export function PurchaseForm({
  productId,
  offers,
  action,
}: {
  productId: string;
  offers: { id: string; label: string }[];
  action: FormAction;
}) {
  return (
    <FormWithState action={action} submitLabel="Registrar compra" resetOnSuccess>
      <input type="hidden" name="productId" value={productId} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Loja/oferta comprada">
          <select name="offerId" defaultValue="" className={inputCls}>
            <option value="">Não vinculada a uma oferta</option>
            {offers.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Quantidade *">
          <input name="quantity" type="number" min={1} max={999} defaultValue={1} required className={inputCls} />
        </Field>
        <Field label="Data da compra">
          <input name="purchasedAt" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className={inputCls} />
        </Field>
        <Field label="Valor pago por unidade (R$) *" name="paidUnitCents">
          <input name="paidUnitCents" required inputMode="decimal" placeholder="0,00" className={inputCls} />
        </Field>
        <Field label="Frete pago (R$)" name="paidShippingCents">
          <input name="paidShippingCents" inputMode="decimal" placeholder="0,00" className={inputCls} />
        </Field>
        <Field label="Observações">
          <input name="notes" maxLength={1000} className={inputCls} />
        </Field>
      </div>
    </FormWithState>
  );
}

export function ListAddForm({
  products,
  action,
}: {
  products: { id: string; name: string }[];
  action: FormAction;
}) {
  return (
    <FormWithState action={action} submitLabel="Adicionar à lista" resetOnSuccess>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Produto *" className="lg:col-span-2">
          <select name="productId" required defaultValue="" className={inputCls}>
            <option value="" disabled>Escolha um produto…</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Cômodo / finalidade">
          <select name="room" defaultValue="Outros" className={inputCls}>
            {ROOMS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </Field>
        <Field label="Quantidade">
          <input name="quantity" type="number" min={1} max={999} defaultValue={1} className={inputCls} />
        </Field>
        <Field label="Orçamento unitário (R$)" hint="Vazio = usa o orçamento do produto">
          <input name="plannedUnitBudgetCents" inputMode="decimal" placeholder="0,00" className={inputCls} />
        </Field>
      </div>
    </FormWithState>
  );
}

export function ListEditForm({
  id,
  room,
  quantity,
  plannedUnitBudget,
  action,
}: {
  id: string;
  room: string;
  quantity: number;
  plannedUnitBudget: string;
  action: FormAction;
}) {
  return (
    <FormWithState action={action} submitLabel="Salvar" buttonClassName="inline-flex rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50" className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <label className="text-xs text-slate-600">
        Cômodo
        <select name="room" defaultValue={room} className={`${inputCls} mt-0.5 py-1.5`}>
          {ROOMS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </label>
      <label className="text-xs text-slate-600">
        Qtd.
        <input name="quantity" type="number" min={1} max={999} defaultValue={quantity} className={`${inputCls} mt-0.5 w-20 py-1.5`} />
      </label>
      <label className="text-xs text-slate-600">
        Orçamento un. (R$)
        <input name="plannedUnitBudgetCents" inputMode="decimal" defaultValue={plannedUnitBudget} className={`${inputCls} mt-0.5 w-32 py-1.5`} />
      </label>
    </FormWithState>
  );
}

export function ListBudgetForm({ defaultValue, action }: { defaultValue: string; action: FormAction }) {
  return (
    <FormWithState action={action} submitLabel="Salvar orçamento" className="flex flex-wrap items-end gap-2">
      <label className="text-sm text-slate-700">
        Orçamento total (R$)
        <input name="totalBudgetCents" inputMode="decimal" defaultValue={defaultValue} placeholder="Ex.: 15.000,00" className={`${inputCls} mt-1 w-56`} />
      </label>
    </FormWithState>
  );
}
