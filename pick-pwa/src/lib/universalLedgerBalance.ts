import type { SupabaseClient } from "@supabase/supabase-js";

/** 該標籤於此管理單位之下，異動前結餘 */
export async function getPreviousLabelBalance(
  admin: SupabaseClient,
  unit_id: string,
  label_record_id: string,
): Promise<number> {
  const { data: last, error: e1 } = await admin
    .from("universal_ledger_records")
    .select("balance_after")
    .eq("unit_id", unit_id)
    .eq("label_record_id", label_record_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!e1 && last && last.balance_after != null) {
    return Number(last.balance_after);
  }

  const { data: deltas, error: e2 } = await admin
    .from("universal_ledger_records")
    .select("quantity_delta")
    .eq("unit_id", unit_id)
    .eq("label_record_id", label_record_id);

  if (e2 || !deltas?.length) return 0;
  return deltas.reduce((s, row) => s + (Number(row.quantity_delta) || 0), 0);
}
