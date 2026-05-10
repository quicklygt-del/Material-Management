"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getSessionUser } from "@/lib/auth";
import { appHref } from "@/lib/appHref";

/** 僅倉儲主管（warehouse_admin）可進入，例如標籤中心、QR 中心。 */
export function SupervisorOnlyGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const u = getSessionUser();
    if (!u || u.role !== "warehouse_admin") {
      router.replace(appHref("/"));
      return;
    }
    setAllowed(true);
  }, [router]);

  if (!allowed) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center bg-slate-50 text-sm font-black text-slate-600">
        驗證權限中…
      </div>
    );
  }

  return <>{children}</>;
}
