"use client";

import { useActionState } from "react";
import { loginAction } from "../actions/auth";
import { initialState } from "@/lib/action-state";
import { Field, inputCls, Notice } from "@/components/ui";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, initialState);
  return (
    <form action={action} className="space-y-4">
      <Field label="E-mail" name="email" error={state.errors?.email}>
        <input id="email" name="email" type="email" autoComplete="username" required className={inputCls} />
      </Field>
      <Field label="Senha" name="password">
        <input id="password" name="password" type="password" autoComplete="current-password" required className={inputCls} />
      </Field>
      {state.message ? <Notice tone="error">{state.message}</Notice> : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-60"
      >
        {pending ? "Verificando…" : "Entrar"}
      </button>
    </form>
  );
}
