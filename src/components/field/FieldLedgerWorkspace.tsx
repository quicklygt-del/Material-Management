"use client";

import { Suspense } from "react";
import { OtherOperationArea } from "@/components/field/OtherOperationArea";

export function FieldLedgerWorkspace() {
  return (
    <Suspense
      fallback={
        <div className="p-8 text-center text-sm font-black text-slate-500">
          …
        </div>
      }
    >
      <OtherOperationArea />
    </Suspense>
  );
}
