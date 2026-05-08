import { FieldAccessGate } from "@/components/field/FieldAccessGate";

/** 舊「現場入口」路徑：依身分導向 /operator、/admin 等 */
export default function FieldHubPage() {
  return (
    <main className="min-h-[100dvh] bg-[#FAFDFC] pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <FieldAccessGate />
    </main>
  );
}
