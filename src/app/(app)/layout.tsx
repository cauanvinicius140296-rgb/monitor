import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { logoutAction } from "../actions/auth";
import { ensureBootstrapped } from "@/db/bootstrap";
import { countUnreadAlerts } from "@/lib/monitoring/alerts-service";
import { getDb } from "@/db/client";
import { NavLinks } from "@/components/nav-links";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  await ensureBootstrapped();
  const unread = await countUnreadAlerts(getDb());
  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-slate-200 bg-white md:fixed md:inset-y-0 md:left-0 md:w-60 md:border-b-0 md:border-r">
        <div className="flex items-center justify-between px-4 py-3 md:block md:px-5 md:py-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">R$</span>
            <span className="font-semibold text-slate-900">Radar de Preços</span>
          </Link>
          <form action={logoutAction} className="md:mt-4">
            <button type="submit" className="text-xs font-medium text-slate-500 hover:text-slate-800">
              Sair
            </button>
          </form>
        </div>
        <NavLinks unread={unread} />
        <p className="hidden px-5 py-4 text-xs text-slate-400 md:absolute md:bottom-0 md:block">{user.email}</p>
      </aside>
      <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 md:ml-60">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
