import { Suspense } from "react";
import { QrCenterLabelProvider } from "@/lib/qrCenterLabel";

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
      <QrCenterLabelProvider>{children}</QrCenterLabelProvider>
    </Suspense>
  );
}
