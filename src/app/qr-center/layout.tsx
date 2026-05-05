import { Suspense } from "react";
import { SupervisorOnlyGate } from "@/components/auth/SupervisorOnlyGate";
import { QrCenterTenantProvider } from "@/lib/qrCenterTenant";

export default function QrCenterLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center bg-slate-100 font-bold text-slate-600">
          載入中…
        </div>
      }
    >
      <SupervisorOnlyGate>
        <QrCenterTenantProvider>{children}</QrCenterTenantProvider>
      </SupervisorOnlyGate>
    </Suspense>
  );
}
