import Link from "next/link";

type Props = {
  backHref?: string;
};

export function MobileFieldHeader({ backHref = "/" }: Props) {
  return (
    <header className="border-b border-emerald-100/90 bg-white shadow-sm">
      <div className="relative mx-auto flex min-h-11 max-w-lg items-center justify-center px-12 pb-2 pt-[max(0.35rem,env(safe-area-inset-top))]">
        <Link
          href={backHref}
          className="absolute left-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-xl text-slate-600 transition-colors hover:bg-slate-100 active:bg-slate-200"
          aria-label="返回"
        >
          ←
        </Link>
        <h1 className="max-w-[min(100%,15rem)] truncate text-center text-[13px] font-black leading-tight tracking-tight text-slate-900 sm:max-w-none sm:text-sm">
          其他作業區
        </h1>
      </div>
    </header>
  );
}
