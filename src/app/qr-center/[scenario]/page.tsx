import { notFound, redirect } from "next/navigation";

const MAP: Record<string, string> = {
  standard: "general",
  surplus: "surplus_rq",
  bundle: "bundle",
  qc: "qc",
};

export default function QrCenterLegacyScenarioPage({
  params,
}: {
  params: { scenario: string };
}) {
  const m = MAP[params.scenario];
  if (!m) notFound();
  redirect(`/qr-center?mode=${m}`);
}
