import { NextResponse } from "next/server";
import { normLedgerItemNo } from "@/lib/warehouseLedger";
import {
  binStockTableReady,
  LEDGER_DEFAULT_BIN,
  normLedgerBinCode,
  reconcileLedgerTotalFromBins,
  setBinQtyExact,
} from "@/lib/ledgerBinCore";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type RowIn = {
  item_no?: unknown;
  item_name?: unknown;
  spec?: unknown;
  on_hand?: unknown;
  stock_quantity?: unknown;
  attrs?: unknown;
  bin_code?: unknown;
};

const MAX_BATCH = 1200;

async function ensureStockPlaceholder(
  admin: NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>,
  item_no: string,
  item_name: string,
  spec: string,
  iso: string,
): Promise<void> {
  const sel = await admin
    .from("warehouse_ledger_stock")
    .select("id")
    .eq("item_no", item_no)
    .maybeSingle();
  if (sel.data) return;
  const base = {
    item_no,
    item_name: item_name.slice(0, 500),
    spec: spec.slice(0, 500),
    updated_at: iso,
  };
  let ins = await admin
    .from("warehouse_ledger_stock")
    .insert({ ...base, stock_quantity: 0 });
  if (ins.error && /column .*stock_quantity.* does not exist/i.test(ins.error.message)) {
    ins = await admin.from("warehouse_ledger_stock").insert({ ...base, on_hand: 0 });
  }
  if (ins.error && !/duplicate|23505/i.test(ins.error.message)) {
    throw new Error(ins.error.message);
  }
}

export async function POST(req: Request) {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) {
    return missingServiceRoleResponse();
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const b = body as Record<string, unknown>;

  const rawRows = Array.isArray(b.rows) ? b.rows : [];
  const rowsIn = rawRows as RowIn[];
  if (!rowsIn.length) {
    return NextResponse.json({ error: "rows 為空" }, { status: 400 });
  }
  if (rowsIn.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `單請求最多 ${MAX_BATCH} 筆，請於前端分批上傳` },
      { status: 400 },
    );
  }

  const iso = new Date().toISOString();
  const withBinKey = rowsIn.some(
    (r) => r && typeof r === "object" && "bin_code" in r,
  );

  const mergeAttrs = (
    prev: Record<string, unknown>,
    incoming: unknown,
  ): Record<string, unknown> => {
    if (incoming && typeof incoming === "object" && !Array.isArray(incoming)) {
      return { ...prev, ...(incoming as Record<string, unknown>) };
    }
    return prev;
  };

  if (withBinKey) {
    if (!(await binStockTableReady(admin))) {
      return NextResponse.json(
        {
          error:
            "Excel 含儲位欄時需先建立 warehouse_ledger_bin_stock（執行 patch_warehouse_ledger_multi_bin.sql）",
        },
        { status: 400 },
      );
    }

    const touched = new Set<string>();
    try {
      for (const raw of rowsIn) {
        const item_no = normLedgerItemNo(raw.item_no);
        if (!item_no) continue;
        const item_name =
          typeof raw.item_name === "string"
            ? raw.item_name.trim().slice(0, 500)
            : "";
        const spec =
          typeof raw.spec === "string" ? raw.spec.trim().slice(0, 500) : "";
        const onHandRaw = Number(raw.stock_quantity ?? raw.on_hand);
        const qty = Number.isFinite(onHandRaw) ? Math.floor(onHandRaw) : NaN;
        if (!Number.isFinite(qty)) {
          return NextResponse.json(
            { error: `料號 ${item_no}：數量非有效整數` },
            { status: 400 },
          );
        }
        const bin = normLedgerBinCode(raw.bin_code);
        await ensureStockPlaceholder(admin, item_no, item_name, spec, iso);
        const attrs = mergeAttrs({}, raw.attrs);
        if (Object.keys(attrs).length > 0) {
          await admin
            .from("warehouse_ledger_stock")
            .update({
              attrs,
              ...(item_name ? { item_name } : {}),
              ...(spec ? { spec } : {}),
              updated_at: iso,
            })
            .eq("item_no", item_no);
        } else if (item_name || spec) {
          await admin
            .from("warehouse_ledger_stock")
            .update({
              ...(item_name ? { item_name } : {}),
              ...(spec ? { spec } : {}),
              updated_at: iso,
            })
            .eq("item_no", item_no);
        }
        const sq = await setBinQtyExact(admin, item_no, bin, qty);
        if (!sq.ok) {
          return NextResponse.json({ error: sq.error }, { status: 500 });
        }
        touched.add(item_no);
      }
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "匯入失敗" },
        { status: 500 },
      );
    }

    for (const itemNo of Array.from(touched)) {
      const rec = await reconcileLedgerTotalFromBins(admin, itemNo);
      if (!rec.ok) {
        return NextResponse.json({ error: rec.error }, { status: 500 });
      }
    }

    return NextResponse.json({
      ok: true,
      upserted: rowsIn.length,
      mode: "per_bin",
    });
  }

  type UpsertRow = {
    item_no: string;
    item_name: string;
    spec: string;
    stock_quantity: number;
    attrs: Record<string, unknown>;
    updated_at: string;
  };

  const acc = new Map<string, UpsertRow>();

  for (const raw of rowsIn) {
    const item_no = normLedgerItemNo(raw.item_no);
    if (!item_no) continue;
    const item_name =
      typeof raw.item_name === "string"
        ? raw.item_name.trim().slice(0, 500)
        : "";
    const spec =
      typeof raw.spec === "string" ? raw.spec.trim().slice(0, 500) : "";
    const onHandRaw = Number(raw.stock_quantity ?? raw.on_hand);
    const on_hand = Number.isFinite(onHandRaw)
      ? Math.floor(onHandRaw)
      : NaN;

    const attrs = mergeAttrs({}, raw.attrs);

    const cur =
      acc.get(item_no) ??
      ({
        item_no,
        item_name: "",
        spec: "",
        stock_quantity: 0,
        attrs: attrs as Record<string, unknown>,
        updated_at: iso,
      } as UpsertRow);

    if (attrs && Object.keys(attrs).length > 0) {
      cur.attrs = mergeAttrs(cur.attrs, attrs);
    }
    cur.item_name = item_name.length ? item_name : cur.item_name;
    cur.spec = spec.length ? spec : cur.spec;
    if (!Number.isFinite(on_hand)) {
      return NextResponse.json(
        { error: `料號 ${item_no}：stock_quantity 非有效數字` },
        { status: 400 },
      );
    }
    cur.stock_quantity = on_hand;
    cur.updated_at = iso;

    acc.set(item_no, cur);
  }

  const payload = Array.from(acc.values());
  if (!payload.length) {
    return NextResponse.json({ error: "無有效列（均需料號）" }, { status: 400 });
  }

  let { error } = await admin.from("warehouse_ledger_stock").upsert(payload, {
    onConflict: "item_no",
  });
  if (error && /column .*stock_quantity.* does not exist/i.test(error.message)) {
    const legacyPayload = payload.map((r) => ({
      ...r,
      on_hand: r.stock_quantity,
      stock_quantity: undefined,
    }));
    ({ error } = await admin.from("warehouse_ledger_stock").upsert(legacyPayload, {
      onConflict: "item_no",
    }));
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (await binStockTableReady(admin)) {
    for (const r of payload) {
      const q = await setBinQtyExact(
        admin,
        r.item_no,
        LEDGER_DEFAULT_BIN,
        r.stock_quantity,
      );
      if (!q.ok) {
        return NextResponse.json({ error: q.error }, { status: 500 });
      }
      const rec = await reconcileLedgerTotalFromBins(admin, r.item_no);
      if (!rec.ok) {
        return NextResponse.json({ error: rec.error }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ ok: true, upserted: payload.length, mode: "totals" });
}
