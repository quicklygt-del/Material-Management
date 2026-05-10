"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { getSessionUser } from "@/lib/auth";
import { appHref } from "@/lib/appHref";

/**
 * /field 僅作舊網址相容導流（倉管員改為 /operator）：
 * · 單位 Cookie → /unit/[slug]
 * · 系統管理 → /admin/other-operations
 * · 倉儲主管 → /admin
 * · 倉管員 → /operator
 * · 其餘 → 首頁
 */
export function FieldAccessGate() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await fetch("/api/unit-portal/session", {
        credentials: "include",
      });
      if (!cancelled && r.ok) {
        const j = (await r.json()) as { slug?: string };
        if (j.slug) {
          router.replace(appHref(`/unit/${encodeURIComponent(j.slug)}`));
          return;
        }
      }

      const s = getSessionUser();
      if (!cancelled && s?.role === "system_admin") {
        router.replace(appHref("/admin/other-operations"));
        return;
      }
      if (!cancelled && s?.role === "warehouse_admin") {
        router.replace(appHref("/admin"));
        return;
      }
      if (!cancelled && s?.role === "warehouse_staff") {
        router.replace(appHref("/operator"));
        return;
      }
      if (!cancelled) router.replace(appHref("/"));
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="flex min-h-[38vh] items-center justify-center bg-[#FAFDFC] text-sm font-black text-purple-950">
      導向中…
    </div>
  );
}
