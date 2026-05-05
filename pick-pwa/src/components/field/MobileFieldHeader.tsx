import Link from "next/link";
import { APP_VERSION } from "@/lib/version";

type Props = {
  backHref?: string;
};

export function MobileFieldHeader({ backHref = "/" }: Props) {
  return (
    <header className="border-b border-emerald-100/90 bg-white shadow-sm">
      <div className="relative mx-auto max-w-lg px-12 pb-1.5 pt-[max(0.35rem,env(safe-area-inset-top))]">
        <div className="relative flex min-h-11 items-center justify-center">
          <Link
            href={backHref}
            className="absolute left-0 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-xl text-slate-600 transition-colors hover:bg-slate-100 active:bg-slate-200"
            aria-label="返回"
          >
            ←
          </Link>
          <div className="flex max-w-[min(100%,16rem)] flex-col items-center text-center">
            <h1 className="truncate text-[13px] font-black leading-tight tracking-tight text-slate-900 sm:max-w-none sm:text-sm">
              其他作業區（Operator UI）
            </h1>
            <p className="truncate text-[9px] font-bold leading-tight text-blue-700 sm:text-[10px]">
              {APP_VERSION}
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}
