import Link from "next/link";
import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5 ${className}`}>{children}</section>;
}

export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-base font-semibold text-slate-900">{children}</h2>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "success" | "warning" | "danger" | "info";
}) {
  const toneClass = {
    default: "text-slate-900",
    success: "text-emerald-700",
    warning: "text-amber-700",
    danger: "text-rose-700",
    info: "text-indigo-700",
  }[tone];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

const BADGE_TONES = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning: "bg-amber-50 text-amber-800 ring-amber-200",
  danger: "bg-rose-50 text-rose-700 ring-rose-200",
  info: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  demo: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200",
} as const;

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: keyof typeof BADGE_TONES }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE_TONES[tone]}`}>
      {children}
    </span>
  );
}

export const btnBase =
  "inline-flex items-center justify-center gap-1 rounded-lg px-3 py-2 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50";
export const btnPrimary = `${btnBase} bg-indigo-600 text-white hover:bg-indigo-500`;
export const btnSecondary = `${btnBase} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;
export const btnDanger = `${btnBase} border border-rose-200 bg-white text-rose-700 hover:bg-rose-50`;
export const btnGhost = `${btnBase} text-slate-600 hover:bg-slate-100`;

export const inputCls =
  "block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30";
export const labelCls = "mb-1 block text-sm font-medium text-slate-700";

export function Field({
  label,
  name,
  error,
  hint,
  children,
  className = "",
}: {
  label: string;
  name?: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={name} className={labelCls}>
        {label}
      </label>
      {children}
      {hint && !error ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
      {error ? <p className="mt-1 text-xs text-rose-600">{error}</p> : null}
    </div>
  );
}

export function Notice({ tone, children }: { tone: "success" | "error" | "info" | "warning"; children: ReactNode }) {
  const cls = {
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    error: "border-rose-200 bg-rose-50 text-rose-800",
    info: "border-indigo-200 bg-indigo-50 text-indigo-800",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
  }[tone];
  return <div role={tone === "error" ? "alert" : "status"} className={`rounded-lg border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {children ? <div className="mt-1 text-sm text-slate-500">{children}</div> : null}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle ? <div className="mt-1 text-sm text-slate-500">{subtitle}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Pagination({
  basePath,
  params,
  page,
  totalPages,
}: {
  basePath: string;
  params: Record<string, string | undefined>;
  page: number;
  totalPages: number;
}) {
  if (totalPages <= 1) return null;
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    q.set("pagina", String(p));
    return `${basePath}?${q.toString()}`;
  };
  return (
    <nav className="mt-4 flex items-center justify-between text-sm text-slate-600" aria-label="Paginação">
      {page > 1 ? <Link className={btnSecondary} href={href(page - 1)}>Anterior</Link> : <span />}
      <span>
        Página {page} de {totalPages}
      </span>
      {page < totalPages ? <Link className={btnSecondary} href={href(page + 1)}>Próxima</Link> : <span />}
    </nav>
  );
}
