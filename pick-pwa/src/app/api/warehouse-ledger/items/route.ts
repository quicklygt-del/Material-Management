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

  const url = new URL(req.url);

  const q = url.searchParams.get("q")?.trim() ?? "";
  const rawLimit = Number(url.searchParams.get("limit"));
  const rawOffset = Number(url.searchParams.get("offset"));
  const limit = Number.isFinite(rawLimit)
    ? Math.min(1500, Math.max(10, rawLimit))
    : 250;
  const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0;

  const qSafe = q.replace(/[%_*\\]/g, "");

  const mapRow = (r: Record<string, unknown>) => ({
    ...r,
    on_hand: Number(r.stock_quantity ?? r.on_hand ?? 0) || 0,
  });

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

  if (!qSafe) {
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
      items: (rows ?? []).map((r) =>
        mapRow(r as unknown as Record<string, unknown>),
      ),
      count: count ?? 0,
      limit,
      offset,
    });
  }

  const selList =
    "id,item_no,item_name,spec,stock_quantity,attrs,updated_at";
  const selLegacy =
    "id,item_no,item_name,spec,on_hand,attrs,updated_at";

  const firstText = await admin
    .from("warehouse_ledger_stock")
    .select(selList)
    .or(`item_no.ilike.%${qSafe}%,item_name.ilike.%${qSafe}%`)
    .order("item_no", { ascending: true })
    .limit(800);
  let textRows: Record<string, unknown>[] | null =
    (firstText.data ?? null) as Record<string, unknown>[] | null;
  let textErr = firstText.error;
  if (
    textErr &&
    /column .*stock_quantity.* does not exist/i.test(textErr.message)
  ) {
    const fb = await admin
      .from("warehouse_ledger_stock")
      .select(selLegacy)
      .or(`item_no.ilike.%${qSafe}%,item_name.ilike.%${qSafe}%`)
      .order("item_no", { ascending: true })
      .limit(800);
    textRows = (fb.data ?? null) as Record<string, unknown>[] | null;
    textErr = fb.error;
  }
  if (textErr) {
    return NextResponse.json({ error: textErr.message }, { status: 500 });
  }

  let binRows: Record<string, unknown>[] = [];
  if (await binStockTableReady(admin)) {
    const { data: binHits, error: bErr } = await admin
      .from("warehouse_ledger_bin_stock")
      .select("item_no")
      .ilike("bin_code", `%${qSafe}%`)
      .limit(800);
    if (!bErr && binHits?.length) {
      const nos = Array.from(
        new Set(
          (binHits as { item_no?: string }[])
            .map((x) => String(x.item_no ?? "").trim())
            .filter(Boolean),
        ),
      );
      if (nos.length) {
        const br1 = await admin
          .from("warehouse_ledger_stock")
          .select(selList)
          .in("item_no", nos)
          .order("item_no", { ascending: true })
          .limit(800);
        let brData: Record<string, unknown>[] | null =
          (br1.data ?? null) as Record<string, unknown>[] | null;
        let brErr = br1.error;
        if (
          brErr &&
          /column .*stock_quantity.* does not exist/i.test(brErr.message)
        ) {
          const br2 = await admin
            .from("warehouse_ledger_stock")
            .select(selLegacy)
            .in("item_no", nos)
            .order("item_no", { ascending: true })
            .limit(800);
          brData = (br2.data ?? null) as Record<string, unknown>[] | null;
          brErr = br2.error;
        }
        if (!brErr) {
          binRows = brData ?? [];
        }
      }
    }
  }

  const mergedMap = new Map<string, Record<string, unknown>>();
  for (const r of textRows ?? []) {
    const k = String(r.item_no ?? "");
    if (k) mergedMap.set(k, r);
  }
  for (const r of binRows) {
    const k = String(r.item_no ?? "");
    if (k && !mergedMap.has(k)) mergedMap.set(k, r);
  }

  const merged = Array.from(mergedMap.values()).sort((a, b) =>
    String(a.item_no ?? "").localeCompare(String(b.item_no ?? "")),
  );
  const slice = merged.slice(offset, offset + limit);

  return NextResponse.json({
    items: slice.map(mapRow),
    count: merged.length,
    limit,
    offset,
  });
}
