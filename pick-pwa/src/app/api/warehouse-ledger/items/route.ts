import { NextResponse } from "next/server";
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

  const url = new URL(req.url);

  const q = url.searchParams.get("q")?.trim() ?? "";
  const rawLimit = Number(url.searchParams.get("limit"));
  const rawOffset = Number(url.searchParams.get("offset"));
  const limit = Number.isFinite(rawLimit)
    ? Math.min(1500, Math.max(10, rawLimit))
    : 250;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0;

  const qSafe = q.replace(/[%_*\\]/g, "");

  const runSelect = (selectList: string) => {
    let query = admin
      .from("warehouse_ledger_stock")
      .select(selectList, { count: "exact" })
      .order("item_no", { ascending: true })
      .range(offset, offset + limit - 1);
    if (qSafe) {
      query = query.or(`item_no.ilike.%${qSafe}%,item_name.ilike.%${qSafe}%`);
    }
    return query;
  };

  let { data: rows, error, count } = await runSelect(
    "id,item_no,item_name,spec,stock_quantity,attrs,updated_at",
  );
  if (error && /column .*stock_quantity.* does not exist/i.test(error.message)) {
    ({ data: rows, error, count } = await runSelect(
      "id,item_no,item_name,spec,on_hand,attrs,updated_at",
    ));
  }
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    items: (rows ?? []).map((r) => {
      const row = r as unknown as Record<string, unknown>;
      return {
        ...row,
        on_hand: Number(row.stock_quantity ?? row.on_hand ?? 0) || 0,
      };
    }),
    count: count ?? 0,
    limit,
    offset,
  });
}
