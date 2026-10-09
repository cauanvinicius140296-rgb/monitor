"use client";

import { useActionState, type ReactNode } from "react";
import { initialState, type ActionState } from "@/lib/action-state";
import { Notice } from "./ui";

export type FormAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * Formulário com feedback de sucesso/erro e estado de envio.
 * A ação é recebida já vinculada no servidor (ex.: `action.bind(null, id)`).
 */
export function FormWithState({
  action,
  children,
  submitLabel,
  pendingLabel = "Salvando…",
  className = "space-y-4",
  buttonClassName,
  resetOnSuccess = false,
}: {
  action: FormAction;
  children: ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  className?: string;
  buttonClassName?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  return (
    <form action={formAction} className={className} key={resetOnSuccess && state.ok ? state.message : undefined}>
      {children}
      {state.message ? <Notice tone={state.ok ? "success" : "error"}>{state.message}</Notice> : null}
      {state.errors && Object.keys(state.errors).length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-rose-700">
          {Object.entries(state.errors).map(([field, msg]) => (
            <li key={field}>{msg}</li>
          ))}
        </ul>
      ) : null}
      <div>
        <button
          type="submit"
          disabled={pending}
          className={
            buttonClassName ??
            "inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-60"
          }
        >
          {pending ? pendingLabel : submitLabel}
        </button>
      </div>
    </form>
  );
}
