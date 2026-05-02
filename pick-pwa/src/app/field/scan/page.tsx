"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { WarehouseTabScanWorkspace } from "@/components/field/WarehouseTabScanWorkspace";
import { MobileFieldHeader } from "@/components/field/MobileFieldHeader";

function ScanInner() {
  const searchParams = useSearchParams();
  return (
    <WarehouseTabScanWorkspace
      cameraMode={searchParams.get("camera") === "1"}
      variant="assetHubCamera"
    />
  );
}

export default function FieldScanPage() {
  return (
    <main className="min-h-[100dvh] bg-[#FAFDFC]">
      <MobileFieldHeader backHref="/field" />
      <Suspense
        fallback={
          <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">
            載入中…
          </div>
        }
      >
        <ScanInner />
      </Suspense>
    </main>
  );
}
