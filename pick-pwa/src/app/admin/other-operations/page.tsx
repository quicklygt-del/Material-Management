"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { exitToLoginHome, getSessionUser } from "@/lib/auth";
import { AppBrandHeader } from "@/components/AppBrandHeader";
import { APP_VERSION } from "@/lib/version";
import { appHref } from "@/lib/appHref";

export default function OtherOperationsAdminPage() {
  const router = useRouter();
  const session = useMemo(() => getSessionUser(), []);

  useEffect(() => {
    if (session?.role !== "system_admin") {
      router.replace(appHref("/"));
    }
  }, [router, session?.role]);

  if (session?.role !== "system_admin") {
    return null;
  }

  return (
    <main className="mx-auto min-h-screen max-w-4xl bg-slate-50 px-4 py-8">
      <AppBrandHeader section="單位設定" align="left" />
      <p className="mt-2 text-[11px] font-black text-blue-700">{APP_VERSION}</p>
      <nav className="mt-6">
        <button
          type="button"
          onClick={() => exitToLoginHome(router)}
          className="text-sm font-black text-red-800 underline"
        >
          登出管理員
        </button>
      </nav>
    </main>
  );
}
