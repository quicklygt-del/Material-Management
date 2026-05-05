import { FieldAccessGate } from "@/components/field/FieldAccessGate";
import { FieldLedgerWorkspace } from "@/components/field/FieldLedgerWorkspace";
import { MobileFieldHeader } from "@/components/field/MobileFieldHeader";

export default function FieldHubPage() {
  return (
    <main className="flex min-h-[100dvh] flex-col bg-[#FAFDFC] pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <FieldAccessGate>
        <MobileFieldHeader backHref="/" />
        <FieldLedgerWorkspace />
      </FieldAccessGate>
    </main>
  );
}
