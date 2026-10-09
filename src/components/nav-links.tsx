"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Painel" },
  { href: "/produtos", label: "Produtos" },
  { href: "/alertas", label: "Alertas" },
  { href: "/lista", label: "Minha Lista de Compras" },
  { href: "/fontes", label: "Fontes e coletas" },
  { href: "/configuracoes", label: "Configurações" },
];

export function NavLinks({ unread }: { unread: number }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Principal" className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible md:px-3 md:pb-0">
      {LINKS.map((l) => {
        const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center justify-between whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${
              active ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            {l.label}
            {l.href === "/alertas" && unread > 0 ? (
              <span className="ml-2 rounded-full bg-rose-600 px-1.5 text-xs font-semibold text-white">{unread}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
