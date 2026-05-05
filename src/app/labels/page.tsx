"use client";

import Link from "next/link";
import { AppBrandHeader } from "@/components/AppBrandHeader";

const CARDS = [
  {
    href: "/labels/standard",
    title: "一般 · 進料收發",
    accent: "border-blue-500 bg-blue-50 hover:bg-blue-100",
  },
  {
    href: "/labels/rnd",
    title: "自定義資產",
    accent: "border-indigo-500 bg-indigo-50 hover:bg-indigo-100",
  },
  {
    href: "/labels/bundle",
    title: "裝箱／集合",
    accent: "border-emerald-600 bg-emerald-50 hover:bg-emerald-100",
  },
  {
    href: "/labels/qc",
    title: "不良品／QC",
    accent: "border-red-600 bg-red-50 hover:bg-red-100",
  },
  {
    href: "/labels/surplus",
    title: "餘料／退料",
    accent: "border-amber-500 bg-amber-50 hover:bg-amber-100",
  },
] as const;

export default function LabelCenterPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col gap-5 p-4 pb-16">
      <header>
        <AppBrandHeader section="標籤中心" />
      </header>

      <div className="grid gap-3">
        {CARDS.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className={`block rounded-2xl border-4 p-4 shadow-sm transition-colors ${c.accent}`}
          >
            <h2 className="text-xl font-black text-slate-900">{c.title}</h2>
          </Link>
        ))}
      </div>
    </main>
  );
}
