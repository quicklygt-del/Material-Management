import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getDefaultLabelPrefix,
  normalizeLabelPrefix,
} from "@/lib/labelEncoding";
import { buildQrLookupCandidates } from "@/lib/qrLookupNormalize";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/** 新庫：含 tenant_id（僅選必定存在之欄，避免舊庫缺欄造成 PostgREST 解析失敗） */
const LABEL_SELECT_FULL =
  "id,tenant_id,label_type,qr_payload,item_no,color_code,operator_id,created_at,meta";

/** 舊庫可能無 tenant_id 欄：SELECT 時勿含 tenant_id */
const LABEL_SELECT_LEGACY =
  "id,label_type,qr_payload,item_no,color_code,operator_id,created_at,meta";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function scopeMissingColumn(msg: string): boolean {
  return /42703|does not exist|tenant_id|company_id/i.test(msg);
}

type ScopeCol = "tenant_id" | "company_id";

async function pickLabelRow(
  admin: SupabaseClient,
  tenant_id: string,
  tryPayloads: string[],
): Promise<{ row: Record<string, unknown> | null; error: string | null }> {
  const scopes: ScopeCol[] = ["tenant_id", "company_id"];

  for (const scopeCol of scopes) {
    const selectStr =
      scopeCol === "tenant_id" ? LABEL_SELECT_FULL : LABEL_SELECT_LEGACY;

    const byPayload = await admin
      .from("label_records")
      .select(selectStr)
      .eq(scopeCol, tenant_id)
      .in("qr_payload", tryPayloads)
      .order("created_at", { ascending: false })
      .limit(1);

    if (byPayload.error) {
      if (scopeMissingColumn(byPayload.error.message)) continue;
      return { row: null, error: byPayload.error.message };
    }
    let row =
      (byPayload.data?.[0] as unknown as Record<string, unknown> | undefined) ??
      null;

    if (!row) {
      const byItem = await admin
        .from("label_records")
        .select(selectStr)
        .eq(scopeCol, tenant_id)
        .in("item_no", tryPayloads)
        .order("created_at", { ascending: false })
        .limit(1);
      if (byItem.error) {
        if (scopeMissingColumn(byItem.error.message)) continue;
        return { row: null, error: byItem.error.message };
      }
      row =
        (byItem.data?.[0] as unknown as Record<string, unknown> | undefined) ??
        null;
    }

    if (!row) {
      for (const c of tryPayloads) {
        if (!UUID_RE.test(c)) continue;
        const byId = await admin
          .from("label_records")
          .select(selectStr)
          .eq(scopeCol, tenant_id)
          .eq("id", c)
          .maybeSingle();
        if (byId.error) {
          if (scopeMissingColumn(byId.error.message)) break;
          return { row: null, error: byId.error.message };
        }
        if (byId.data) {
          row = byId.data as unknown as Record<string, unknown>;
          break;
        }
      }
    }

    if (row) return { row, error: null };
  }

  return { row: null, error: null };
}

async function fetchLedgerStockRow(
  admin: SupabaseClient,
  tenant_id: string,
  item_no: string,
): Promise<{
  item_name: string;
  spec: string;
  on_hand: number;
} | null> {
  const normItem = item_no.replace(/\uFEFF/g, "").trim();
  if (!normItem) return null;

  const tryScopes = [
    async () =>
      admin
        .from("warehouse_ledger_stock")
        .select("item_name,spec,stock_quantity,on_hand")
        .eq("tenant_id", tenant_id)
        .eq("item_no", normItem)
        .order("updated_at", { ascending: false })
        .limit(1),
    async () =>
      admin
        .from("warehouse_ledger_stock")
        .select("item_name,spec,stock_quantity,on_hand")
        .eq("company_id", tenant_id)
        .eq("item_no", normItem)
        .order("updated_at", { ascending: false })
        .limit(1),
    async () =>
      admin
        .from("warehouse_ledger_stock")
        .select("item_name,spec,stock_quantity,on_hand")
        .eq("item_no", normItem)
        .order("updated_at", { ascending: false })
        .limit(1),
  ];

  for (const run of tryScopes) {
    const res = await run();
    if (res.error) {
      if (scopeMissingColumn(res.error.message)) continue;
      return null;
    }
    const data = (res.data?.[0] ?? null) as Record<string, unknown> | null;
    if (!data) continue;
    const onHand =
      Number(data.stock_quantity ?? data.on_hand ?? 0) || 0;
    return {
      item_name: String(data.item_name ?? "").trim(),
      spec: String(data.spec ?? "").trim(),
      on_hand: onHand,
    };
  }

  return null;
}

export async function GET(req: Request) {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) {
    return missingServiceRoleResponse();
  }

  const url = new URL(req.url);
  const fromQuery = normalizeLabelPrefix(url.searchParams.get("tenant") ?? "");
  const tenant_id = fromQuery || getDefaultLabelPrefix();
  const qr_in = url.searchParams.get("qr")?.trim() ?? "";
  if (!tenant_id) {
    return NextResponse.json({ error: "無法解析公司識別" }, { status: 400 });
  }
  if (!qr_in) {
    return NextResponse.json({ error: "請提供 qr（完整標籤字串）" }, { status: 400 });
  }

  const candidates = buildQrLookupCandidates(qr_in);
  if (candidates.length === 0) {
    return NextResponse.json(
      { error: "qr 內容無法解析" },
      { status: 400 },
    );
  }

  const tryPayloads = candidates.slice(0, 32);

  const { row, error } = await pickLabelRow(admin, tenant_id, tryPayloads);
  if (error) {
    return NextResponse.json(
      { error: `查詢失敗：${error}` },
      { status: 500 },
    );
  }

  if (!row) {
    return NextResponse.json({
      found: false,
      tenant_id,
      qr_payload: qr_in,
      message: "查無此料號，請檢查資料庫設定",
    });
  }

  const itemNo = String(row.item_no ?? "").trim();
  const meta = (row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
    ? (row.meta as Record<string, unknown>)
    : {}) as Record<string, unknown>;

  const ledger = await fetchLedgerStockRow(admin, tenant_id, itemNo);

  const metaName = String(meta.item_name ?? meta.product_name ?? "").trim();
  const metaSpec = String(meta.spec ?? "").trim();

  const inventory = ledger
    ? {
        item_name: ledger.item_name || metaName || "",
        spec: ledger.spec || metaSpec || "",
        on_hand: ledger.on_hand,
      }
    : {
        item_name: metaName,
        spec: metaSpec,
        on_hand: 0,
      };

  return NextResponse.json({
    found: true,
    record: row,
    inventory,
  });
}
