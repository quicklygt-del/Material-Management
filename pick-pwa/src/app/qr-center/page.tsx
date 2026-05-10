"use client";

import Link from "next/link";
import { AppBrandHeader } from "@/components/AppBrandHeader";
import { QrCenterGenerator } from "@/components/qr/QrCenterGenerator";
import { appHref } from "@/lib/appHref";

export default function QrCenterHubPage() {
  return (
    <>
      <header className="sticky top-0 z-40 border-b border-amber-300/80 bg-gradient-to-r from-amber-50 to-orange-50 px-4 py-3 shadow-sm">
        <div className="mx-auto flex max-w-lg flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <AppBrandHeader section="標籤產製工作站" align="left" />
          </div>
          <div className="flex shrink-0 flex-col gap-2">
            <Link
              href={appHref("/operator")}
              className="rounded-lg border-2 border-emerald-600 bg-white px-3 py-2 text-center text-xs font-black text-emerald-900 shadow-sm hover:bg-emerald-50"
            >
              倉管員工作台
            </Link>
            <Link
              href={appHref("/")}
              className="rounded-lg border-2 border-amber-900 bg-white px-3 py-2 text-center text-xs font-black text-amber-950 shadow-sm transition-colors hover:bg-amber-100"
            >
              門戶首頁
            </Link>
          </div>
        </div>
      </header>
      <QrCenterGenerator />
    </>
  );
}
