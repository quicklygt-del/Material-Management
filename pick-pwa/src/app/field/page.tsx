import { Suspense } from "react";
import { FieldLedgerWorkspace } from "@/components/field/FieldLedgerWorkspace";
import { MobileFieldHeader } from "@/components/field/MobileFieldHeader";

export default function FieldHubPage() {
  return (
    <main className="flex min-h-[100dvh] flex-col bg-[#FAFDFC] pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <MobileFieldHeader backHref="/" />
      <Suspense
        fallback={
          <div className="p-8 text-center text-sm font-black text-slate-500">
            …
          </div>
        }
      >
        <FieldLedgerWorkspace />
      </Suspense>
    </main>
  );
}
