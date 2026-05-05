import { Suspense } from "react";
import { QrCenterTenantProvider } from "@/lib/qrCenterTenant";

export default function FieldLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center bg-sky-50 font-bold text-sky-800">
          載入中…
        </div>
      }
    >
      <QrCenterTenantProvider>{children}</QrCenterTenantProvider>
    </Suspense>
  );
}
