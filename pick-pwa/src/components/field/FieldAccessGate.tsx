"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getSessionUser } from "@/lib/auth";

/**
 * 倉儲「其他作業區」門禁：
 * · 已由單位 Cookie 授權者 → /unit/[slug]
 * · 系統管理 → /admin/other-operations（單位設定）
 * · 無倉管員身分 → 首頁
 */
export function FieldAccessGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const r = await fetch("/api/unit-portal/session", {
        credentials: "include",
      });
      if (!cancelled && r.ok) {
        const j = (await r.json()) as { slug?: string };
        if (j.slug) {
          router.replace(`/unit/${encodeURIComponent(j.slug)}`);
          return;
        }
      }

      const s = getSessionUser();
      if (!cancelled && s?.role === "system_admin") {
        router.replace("/admin/other-operations");
        return;
      }
      if (!cancelled && s?.role === "warehouse_admin") {
        router.replace("/admin");
        return;
      }
      const isStaff = s?.role === "warehouse_staff";
      if (!cancelled && (!s || !isStaff)) {
        router.replace("/");
        return;
      }

      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!ready) {
    return (
      <div className="flex min-h-[38vh] items-center justify-center bg-[#FAFDFC] text-sm font-black text-purple-950">
        驗證權限中…
      </div>
    );
  }

  return <>{children}</>;
}
