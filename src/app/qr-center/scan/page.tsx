"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { WarehouseTabScanWorkspace } from "@/components/field/WarehouseTabScanWorkspace";

function ScanInner() {
  const searchParams = useSearchParams();
  return (
    <WarehouseTabScanWorkspace
      cameraMode={searchParams.get("camera") === "1"}
      variant="standalone"
    />
  );
}

export default function QrScanIdentifyPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[30vh] items-center justify-center bg-zinc-100 font-bold text-zinc-600">
          載入中…
        </div>
      }
    >
      <ScanInner />
    </Suspense>
  );
}
