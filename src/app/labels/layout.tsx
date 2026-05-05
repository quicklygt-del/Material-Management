"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { SupervisorOnlyGate } from "@/components/auth/SupervisorOnlyGate";

/**
 * 標籤中心僅倉儲主管可進入。
 */
export default function LabelsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const atHub = pathname === "/labels";

  return (
    <SupervisorOnlyGate>
      <nav className="sticky top-0 z-40 flex flex-wrap items-center justify-end gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur-sm">
        {!atHub && (
          <Link
            href="/labels"
            className="mr-auto text-sm font-black text-blue-800 underline decoration-2"
          >
            ← 標籤中心
          </Link>
        )}
        <Link
          href="/admin/warehouse-ledger"
          className="text-sm font-black text-indigo-800 underline decoration-2"
        >
          倉儲總帳
        </Link>
        <Link href="/field" className="text-sm font-bold text-emerald-800 underline">
          行動資產區
        </Link>
        <Link href="/" className="text-sm font-bold text-slate-600 underline">
          門戶首頁
        </Link>
      </nav>
      {children}
    </SupervisorOnlyGate>
  );
}
