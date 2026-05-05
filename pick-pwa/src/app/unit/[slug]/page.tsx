import { Suspense } from "react";
import { UnitDedicatedWorkspace } from "@/components/field/UnitDedicatedWorkspace";

export default function UnitOperationRoutePage({
  params,
}: {
  params: { slug: string };
}) {
  const slug = decodeURIComponent(params.slug ?? "");
  return (
    <Suspense
      fallback={
        <p className="py-24 text-center text-sm font-black text-purple-950">
          載入…
        </p>
      }
    >
      <UnitDedicatedWorkspace slug={slug} />
    </Suspense>
  );
}
