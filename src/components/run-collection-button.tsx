"use client";

import { useState, useTransition } from "react";
import { runManualCollectionAction } from "@/app/actions/collection";
import { Notice } from "./ui";

export function RunCollectionButton({ productId, label = "Atualizar agora" }: { productId?: string; label?: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const r = await runManualCollectionAction(productId);
            setResult({ ok: r.ok, message: r.message ?? "" });
          })
        }
        className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
      >
        {pending ? "Consultando fontes…" : label}
      </button>
      {result?.message ? <Notice tone={result.ok ? "success" : "error"}>{result.message}</Notice> : null}
    </div>
  );
}
