import * as XLSX from "xlsx";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PickingLogExportRow = {
  order_no: string;
  item_no: string;
  actual_qty: number;
  operator: string | null;
  /** 額外欄位給對帳用 */
  nfc_uid?: string | null;
  created_at?: string;
  variance_note?: string | null;
};

function startEndOfToday(): { startIso: string; endIso: string } {
  const d = new Date();
  const y = d.getFullYear();
  const m = d.getMonth();
  const day = d.getDate();
  const start = new Date(y, m, day, 0, 0, 0);
  const end = new Date(y, m, day + 1, 0, 0, 0);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export async function fetchTodayPickingLogs(
  supabase: SupabaseClient,
  tenantSlug: string,
): Promise<PickingLogExportRow[]> {
  const { startIso, endIso } = startEndOfToday();
  const tz = tenantSlug.trim();
  const withVariance = await supabase
    .from("picking_logs")
    .select("order_no,item_no,actual_qty,operator,nfc_uid,created_at,variance_note")
    .eq("tenant_id", tz)
    .gte("created_at", startIso)
    .lt("created_at", endIso)
    .order("created_at", { ascending: false });
  let data = withVariance.data as PickingLogExportRow[] | null;
  let error = withVariance.error;
  if (error?.message.includes("variance_note")) {
    const fallback = await supabase
      .from("picking_logs")
      .select("order_no,item_no,actual_qty,operator,nfc_uid,created_at")
      .eq("tenant_id", tz)
      .gte("created_at", startIso)
      .lt("created_at", endIso)
      .order("created_at", { ascending: false });
    data = (fallback.data ?? []).map((x) => ({ ...x, variance_note: null }));
    error = fallback.error;
  }
  if (error) throw new Error(error.message);
  return data ?? [];
}

export function downloadPickingLogsExcel(
  rows: PickingLogExportRow[],
  filename: string,
) {
  const ws = XLSX.utils.json_to_sheet(
    rows.map((r) => ({
      order_no: r.order_no,
      item_no: r.item_no,
      actual_qty: r.actual_qty,
      operator: r.operator ?? "",
    })),
    { header: ["order_no", "item_no", "actual_qty", "operator"] },
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "picking_logs");
  XLSX.writeFile(wb, filename);
}

export function downloadPickingLogsCsv(
  rows: PickingLogExportRow[],
  filename: string,
) {
  const header = [
    "created_at",
    "order_no",
    "item_no",
    "actual_qty",
    "operator",
    "nfc_uid",
    "variance_note",
  ];
  const lines = [
    header.join(","),
    ...rows.map((r) =>
      [
        r.created_at ?? "",
        r.order_no,
        r.item_no,
        String(r.actual_qty ?? 0),
        r.operator ?? "",
        r.nfc_uid ?? "",
        r.variance_note ?? "",
      ]
        .map((x) => `\"${String(x).replace(/\"/g, '\"\"')}\"`)
        .join(","),
    ),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
