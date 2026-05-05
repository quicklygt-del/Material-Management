"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  UnitLedgerTable,
  type UnitLedgerLine,
} from "@/components/field/UnitLedgerTable";

type UnitCtxLite = {
  unit_id: string;
  slug: string;
  name: string;
  tenant_id: string;
};

export default function UnitLedgerPreviewPage() {
  const params = useParams();
  const router = useRouter();
  const slugParam = decodeURIComponent(String(params.slug ?? ""));
  const [ctx, setCtx] = useState<UnitCtxLite | null>(null);
  const [ctxErr, setCtxErr] = useState<string | null>(null);
  const [lines, setLines] = useState<UnitLedgerLine[]>([]);
  const [linesBusy, setLinesBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const res = await fetch("/api/unit-portal/session", {
        credentials: "include",
      });
      const j = (await res.json().catch(() => ({}))) as Partial<UnitCtxLite> & {
        error?: string;
      };
      if (!alive) return;
      if (!res.ok) {
        setCtxErr(j.error ?? "無法載入身分");
        return;
      }
      const slug = String(j.slug ?? "");
      setCtx({
        unit_id: String(j.unit_id ?? ""),
        slug,
        name: String(j.name ?? ""),
        tenant_id: String(j.tenant_id ?? ""),
      });
      if (slug && slug !== slugParam) {
        router.replace(`/unit/${encodeURIComponent(slug)}/ledger-preview`);
      }
    })();
    return () => {
      alive = false;
    };
  }, [slugParam, router]);

  const loadLines = useCallback(async () => {
    if (!ctx) return;
    setLinesBusy(true);
    try {
      const u = new URL("/api/universal-ledger/lines", window.location.origin);
      u.searchParams.set("tenant", ctx.tenant_id);
      u.searchParams.set("unit_id", ctx.unit_id);
      const res = await fetch(u.toString(), { credentials: "include" });
      const json = (await res.json()) as {
        lines?: UnitLedgerLine[];
        error?: string;
      };
      if (!res.ok) throw new Error(json.error ?? "讀取失敗");
      setLines(json.lines ?? []);
    } catch {
      setLines([]);
    } finally {
      setLinesBusy(false);
    }
  }, [ctx]);

  useEffect(() => {
    void loadLines();
  }, [loadLines]);

  const exportHref = ctx
    ? `/api/universal-ledger/export?tenant=${encodeURIComponent(ctx.tenant_id)}&unit_id=${encodeURIComponent(ctx.unit_id)}&format=xlsx`
    : "#";

  const homeHref = ctx
    ? `/unit/${encodeURIComponent(ctx.slug)}`
    : `/unit/${encodeURIComponent(slugParam)}`;

  if (ctxErr) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center text-sm font-black text-red-700">
        {ctxErr}
        <Link
          href={`/unit/${encodeURIComponent(slugParam)}`}
          className="mx-auto mt-6 block rounded-xl bg-slate-900 px-6 py-3 text-white"
        >
          返回
        </Link>
      </div>
    );
  }

  if (!ctx) {
    return (
      <p className="py-24 text-center text-sm font-black text-slate-500">
        載入中…
      </p>
    );
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col bg-[#FAFCFC] font-sans text-zinc-900">
      <header className="sticky top-0 z-10 border-b border-emerald-200 bg-emerald-50 px-4 pb-3 pt-[max(0.55rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between gap-2">
          <Link
            href={homeHref}
            className="shrink-0 text-sm font-black text-emerald-800 underline"
          >
            ← 返回
          </Link>
          <button
            type="button"
            onClick={() => void loadLines()}
            className="shrink-0 text-xs font-bold text-emerald-700 underline"
          >
            重新整理
          </button>
        </div>
        <h1 className="mt-2 text-center text-base font-black text-emerald-950">
          總帳預覽 · {ctx.name}
        </h1>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <h2 className="text-base font-black text-zinc-800">本單位異動明細</h2>
        <div className="min-h-0 flex-1">
          <UnitLedgerTable
            lines={lines}
            linesBusy={linesBusy}
            maxHeightClass="max-h-[calc(100dvh-16rem-env(safe-area-inset-bottom))]"
          />
        </div>

        <a
          href={exportHref}
          className="flex min-h-[3.5rem] w-full shrink-0 items-center justify-center rounded-xl bg-emerald-800 px-4 py-4 text-center text-lg font-black text-white shadow-lg"
        >
          下載 Excel 總帳
        </a>
      </main>
    </div>
  );
}
