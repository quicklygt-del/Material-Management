"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "派單控制台", matchPrefix: "/admin" },
  { href: "/admin/settings", label: "倉管員設定", matchPrefix: "/admin/settings" },
  {
    href: "/admin/warehouse-ledger",
    label: "倉儲總帳",
    matchPrefix: "/admin/warehouse-ledger",
  },
] as const;

function activeFor(pathname: string, prefix: string) {
  if (prefix === "/admin") {
    return (
      pathname === "/admin" || pathname.startsWith("/admin/dashboard")
    );
  }
  return pathname.startsWith(prefix);
}

export function WarehouseSupervisorNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="倉儲主管選單"
      className="flex flex-wrap gap-x-4 gap-y-2 border-b border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-black shadow-sm"
    >
      {LINKS.map((l) => {
        const on = activeFor(pathname ?? "", l.matchPrefix);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={
              on
                ? "text-blue-900 underline decoration-2"
                : "text-slate-600 hover:text-blue-800 hover:underline"
            }
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
