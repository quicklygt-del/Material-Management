"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

function InviteConsumeInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const token = String(sp.get("t") ?? "").trim();
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    if (!token) {
      setMsg("缺少邀請參數");
      return undefined;
    }
    void (async () => {
      const res = await fetch("/api/unit-portal/invite-consume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        slug?: string;
        error?: string;
      };
      if (!alive) return;
      if (!res.ok) {
        setMsg(j.error ?? "邀請無效");
        return;
      }
      const slug = j.slug?.trim();
      if (slug) router.replace(`/unit/${encodeURIComponent(slug)}`);
      else setMsg("回應缺少路徑");
    })();
    return () => {
      alive = false;
    };
  }, [router, token]);

  return (
    <main className="flex min-h-[100dvh] flex-col items-center bg-zinc-900 px-4 py-14 text-white">
      <p className="text-center font-black tracking-tight">
        {msg ? msg : "正在授權進入…"}
      </p>
      <Link
        href="/"
        className="mt-10 text-sm font-bold text-emerald-300 underline"
      >
        回首頁
      </Link>
    </main>
  );
}

export default function UnitInvitePage() {
  return (
    <Suspense
      fallback={
        <div className="p-16 text-center text-white bg-zinc-900">
          …
        </div>
      }
    >
      <InviteConsumeInner />
    </Suspense>
  );
}
