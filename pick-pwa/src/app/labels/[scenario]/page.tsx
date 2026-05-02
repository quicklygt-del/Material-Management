import { notFound } from "next/navigation";
import { LabelWorkbench } from "@/components/labels/LabelWorkbench";
import type { LabelTypeCode } from "@/lib/labelEncoding";

const SCENARIOS: Record<
  string,
  {
    code: LabelTypeCode;
    title: string;
    excel: boolean;
    variant: "default" | "danger";
  }
> = {
  standard: {
    code: "S",
    title: "進料收發 · 採購單批次印標",
    excel: true,
    variant: "default",
  },
  surplus: {
    code: "R",
    title: "餘料／退料 · 屬性標籤",
    excel: false,
    variant: "default",
  },
  bundle: {
    code: "B",
    title: "裝箱／集合 · 集合標籤",
    excel: false,
    variant: "default",
  },
  qc: {
    code: "Q",
    title: "不良品／QC · 警示標籤",
    excel: false,
    variant: "danger",
  },
  rnd: {
    code: "D",
    title: "自定義資產",
    excel: false,
    variant: "default",
  },
};

export function generateStaticParams() {
  return Object.keys(SCENARIOS).map((scenario) => ({ scenario }));
}

export default function LabelScenarioPage({
  params,
}: {
  params: { scenario: string };
}) {
  const cfg = SCENARIOS[params.scenario];
  if (!cfg) notFound();

  return (
    <main className="mx-auto w-full max-w-lg pb-16 pt-2">
      <div className="px-4">
        <h1 className="text-xl font-black leading-snug text-slate-900 sm:text-2xl">
          {cfg.title}
        </h1>
      </div>
      <div className="mt-4 px-4">
        <LabelWorkbench
          typeCode={cfg.code}
          scenarioTitle={cfg.title}
          variant={cfg.variant}
          enableExcel={cfg.excel}
          authMode="public"
        />
      </div>
    </main>
  );
}
