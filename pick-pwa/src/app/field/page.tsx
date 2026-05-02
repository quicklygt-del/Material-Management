import Link from "next/link";
import { MobileFieldHeader } from "@/components/field/MobileFieldHeader";

export default function FieldHubPage() {
  return (
    <main className="flex min-h-[100dvh] flex-col bg-[#FAFDFC] pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <MobileFieldHeader backHref="/" />

      <section
        aria-label="入口"
        className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-start gap-2 px-3 pt-3 sm:gap-2.5 sm:pt-4"
      >
        <Link
          href="/field/scan?camera=1"
          className="flex min-h-[3.25rem] shrink-0 items-center justify-center rounded-2xl border border-emerald-200/90 bg-white px-4 py-3 text-base font-black text-slate-900 shadow-sm transition-transform active:scale-[0.99]"
        >
          快速辨識
        </Link>

        <Link
          href="/labels"
          className="flex min-h-[3.25rem] shrink-0 items-center justify-center rounded-2xl border border-violet-200/90 bg-white px-4 py-3 text-base font-black text-slate-900 shadow-sm transition-transform active:scale-[0.99]"
        >
          標籤模版
        </Link>

        <Link
          href="/qr-center"
          className="flex min-h-[3.25rem] shrink-0 items-center justify-center rounded-2xl border border-sky-200/90 bg-white px-4 py-3 text-base font-black text-slate-900 shadow-sm transition-transform active:scale-[0.99]"
        >
          QR 印製站
        </Link>
      </section>
    </main>
  );
}
