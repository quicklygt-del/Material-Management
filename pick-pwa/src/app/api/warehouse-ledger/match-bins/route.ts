import { NextResponse } from "next/server";
import { binStockTableReady } from "@/lib/ledgerBinCore";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) {
    return missingServiceRoleResponse();
  }

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (!q || q.length < 1) {
    return NextResponse.json({ item_nos: [] as string[] });
  }

  if (!(await binStockTableReady(admin))) {
    return NextResponse.json({ item_nos: [] as string[] });
  }

  const safe = q.replace(/%/g, "").slice(0, 64);
  const { data, error } = await admin
    .from("warehouse_ledger_bin_stock")
    .select("item_no")
    .ilike("bin_code", `%${safe}%`)
    .limit(500);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const set = new Set<string>();
  for (const r of data ?? []) {
    const no = String((r as { item_no?: string }).item_no ?? "").trim();
    if (no) set.add(no);
  }

  return NextResponse.json({ item_nos: Array.from(set) });
}
