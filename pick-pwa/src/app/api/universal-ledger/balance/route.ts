import { NextResponse } from "next/server";
import {
  getDefaultLabelPrefix,
  normalizeLabelPrefix,
} from "@/lib/labelEncoding";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/** 單一分頁 × 標籤：優先讀最後一筆結餘欄位，否則加總 quantity_delta */
export async function GET(req: Request) {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) {
    return missingServiceRoleResponse();
  }

  const url = new URL(req.url);
  const  =
    normalizeLabelPrefix(url.searchParams.get("tenant") ?? "") ||
    getDefaultLabelPrefix();
  const unit_id = url.searchParams.get("unit_id")?.trim();
  const label_record_id = url.searchParams.get("label_record_id")?.trim();

  if (! || !unit_id || !label_record_id) {
    return NextResponse.json(
      { error: "缺少 tenant、unit_id 或 label_record_id" },
      { status: 400 },
    );
  }

  const { data: last, error: e1 } = await admin
    .from("universal_ledger_records")
    .select("balance_after")
    .eq("", )
    .eq("unit_id", unit_id)
    .eq("label_record_id", label_record_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!e1 && last && last.balance_after != null) {
    return NextResponse.json({ on_hand: Number(last.balance_after) });
  }

  const { data, error } = await admin
    .from("universal_ledger_records")
    .select("quantity_delta")
    .eq("", )
    .eq("unit_id", unit_id)
    .eq("label_record_id", label_record_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const onHand = (data ?? []).reduce(
    (s, row) => s + (Number(row.quantity_delta) || 0),
    0,
  );

  return NextResponse.json({ on_hand: onHand });
}
