import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getDefaultLabelPrefix,
  normalizeLabelPrefix,
} from "@/lib/labelEncoding";
import { buildQrLookupCandidates } from "@/lib/qrLookupNormalize";
import {
  fetchPublicTableColumns,
  pickItemMatchColumns,
  pickNumericQtyColumn,
  pickScopeColumns,
  selectExistingColumns,
} from "@/lib/supabaseSchemaDiscovery";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const LABEL_SELECT_FULL =
  "id,tenant_id,label_type,qr_payload,item_no,color_code,operator_id,created_at,meta";

const LABEL_SELECT_LEGACY =
  "id,label_type,qr_payload,item_no,color_code,operator_id,created_at,meta";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const LEDGER_SELECT_CANDIDATES = [
  "id",
  "tenant_id",
  "company_id",
  "item_no",
  "item_code",
  "item_name",
  "spec",
  "stock_quantity",
  "on_hand",
  "updated_at",
  "created_at",
];

const INV_SELECT_CANDIDATES = [
  "id",
  "tenant_id",
  "company_id",
  "item_code",
  "item_no",
  "item_name",
  "spec",
  "meta",
];

function dbConnJson(status: number, detail?: string) {
  return NextResponse.json(
    {
      error: "Database Connection Error",
      ...(detail ? { detail } : {}),
    },
    { status },
  );
}

function scopeMissingColumn(msg: string): boolean {
  return /42703|does not exist|tenant_id|company_id/i.test(msg);
}

type ScopeCol = "tenant_id" | "company_id";

function orderColumn(cols: Set<string>): string | null {
  if (cols.has("updated_at")) return "updated_at";
  if (cols.has("created_at")) return "created_at";
  return null;
}

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

async function queryLedgerByCandidate(
  admin: SupabaseClient,
  tenant_id: string,
  candidate: string,
  colSet: Set<string>,
): Promise<{
  row: Record<string, unknown> | null;
  error: string | null;
  fatal: boolean;
}> {
  const itemCols = pickItemMatchColumns(colSet);
  if (itemCols.length === 0) {
    return {
      row: null,
      error: "warehouse_ledger_stock 缺少 item_code / item_no 欄位",
      fatal: true,
    };
  }

  const selectStr = selectExistingColumns(colSet, LEDGER_SELECT_CANDIDATES);
  if (!selectStr.includes("id")) {
    return {
      row: null,
      error: "warehouse_ledger_stock 缺少 id 欄位",
      fatal: true,
    };
  }

  const scopes = pickScopeColumns(colSet);
  const oc = orderColumn(colSet);
  const norm = candidate.replace(/\uFEFF/g, "").trim();

  type Attempt = { scope?: ScopeCol };
  const attempts: Attempt[] = [];
  for (const s of scopes) attempts.push({ scope: s });
  attempts.push({});

  for (const itemCol of itemCols) {
    for (const att of attempts) {
      let q = admin.from("warehouse_ledger_stock").select(selectStr).eq(itemCol, norm);
      if (att.scope) q = q.eq(att.scope, tenant_id);
      if (oc) q = q.order(oc, { ascending: false });
      q = q.limit(1);
      const res = await q;
      if (res.error) {
        if (scopeMissingColumn(res.error.message)) continue;
        return { row: null, error: res.error.message, fatal: true };
      }
      const rows = Array.isArray(res.data) ? res.data : [];
      const row = rows[0] as unknown as Record<string, unknown> | undefined;
      if (row) return { row, error: null, fatal: false };
    }
  }

  return { row: null, error: null, fatal: false };
}

async function queryInventoryByCandidate(
  admin: SupabaseClient,
  tenant_id: string,
  candidate: string,
  colSet: Set<string>,
): Promise<{
  row: Record<string, unknown> | null;
  error: string | null;
  fatal: boolean;
}> {
  if (!colSet.has("item_code")) {
    return { row: null, error: null, fatal: false };
  }

  const selectStr = selectExistingColumns(colSet, INV_SELECT_CANDIDATES);
  if (!selectStr) {
    return { row: null, error: null, fatal: false };
  }

  const scopes = pickScopeColumns(colSet);
  const norm = candidate.replace(/\uFEFF/g, "").trim();
  const oc = orderColumn(colSet);

  type Attempt = { scope?: ScopeCol };
  const attempts: Attempt[] = [];
  for (const s of scopes) attempts.push({ scope: s });
  attempts.push({});

  for (const att of attempts) {
    let q = admin.from("inventory_items").select(selectStr).eq("item_code", norm);
    if (att.scope) q = q.eq(att.scope, tenant_id);
    if (oc) q = q.order(oc, { ascending: false });
    q = q.limit(1);
    const res = await q;
    if (res.error) {
      const msg = res.error.message;
      if (/does not exist|schema cache|Could not find/i.test(msg)) {
        return { row: null, error: null, fatal: false };
      }
      if (scopeMissingColumn(msg)) continue;
      return { row: null, error: msg, fatal: true };
    }
    const rows = Array.isArray(res.data) ? res.data : [];
    const row = rows[0] as unknown as Record<string, unknown> | undefined;
    if (row) return { row, error: null, fatal: false };
  }

  return { row: null, error: null, fatal: false };
}

function mergeInventory(
  ledgerRow: Record<string, unknown> | null,
  invRow: Record<string, unknown> | null,
  qtyCol: string | null,
): { item_name: string; spec: string; on_hand: number } {
  let fromLedger = 0;
  if (ledgerRow) {
    if (qtyCol && qtyCol in ledgerRow) {
      fromLedger = Number(ledgerRow[qtyCol] ?? 0);
    } else {
      fromLedger = Number(
        ledgerRow.stock_quantity ?? ledgerRow.on_hand ?? 0,
      );
    }
  }

  const invMeta =
    invRow?.meta && typeof invRow.meta === "object" && !Array.isArray(invRow.meta)
      ? (invRow.meta as Record<string, unknown>)
      : {};

  const nameLedger = String(ledgerRow?.item_name ?? "").trim();
  const specLedger = String(ledgerRow?.spec ?? "").trim();
  const nameInv = String(invRow?.item_name ?? invMeta.item_name ?? "").trim();
  const specInv = String(invRow?.spec ?? invMeta.spec ?? "").trim();

  return {
    item_name: nameLedger || nameInv,
    spec: specLedger || specInv,
    on_hand: Number.isFinite(fromLedger) ? fromLedger : 0,
  };
}

export async function GET(req: Request) {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) {
    return missingServiceRoleResponse();
  }

  const ping = await admin.from("warehouse_ledger_stock").select("id").limit(1);
  if (ping.error && !scopeMissingColumn(ping.error.message)) {
    return dbConnJson(503, ping.error.message);
  }

  const stockProbe = await fetchPublicTableColumns(admin, "warehouse_ledger_stock");
  if (
    stockProbe.columns == null &&
    stockProbe.source === "unavailable"
  ) {
    return dbConnJson(
      503,
      stockProbe.detail ?? "無法讀取 warehouse_ledger_stock",
    );
  }

  const stockCols = new Set(stockProbe.columns ?? []);
  const qtyCol = pickNumericQtyColumn(stockCols);

  const invProbe = await fetchPublicTableColumns(admin, "inventory_items");
  const invCols =
    invProbe.columns != null && invProbe.source !== "unavailable"
      ? new Set(invProbe.columns)
      : null;

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
    return NextResponse.json({ error: "qr 內容無法解析" }, { status: 400 });
  }

  const tryPayloads = candidates.slice(0, 32);

  /** 主路徑：inventory_items + warehouse_ledger_stock（依實際欄位），比對 item_code / item_no */
  for (const cand of tryPayloads) {
    let ledgerRow: Record<string, unknown> | null = null;
    let invRow: Record<string, unknown> | null = null;

    const invRes =
      invCols && invCols.size > 0
        ? await queryInventoryByCandidate(admin, tenant_id, cand, invCols)
        : { row: null as Record<string, unknown> | null, error: null as string | null, fatal: false };

    if (invRes.error && invRes.fatal) {
      return dbConnJson(503, invRes.error);
    }
    invRow = invRes.row;

    const ledgerRes = await queryLedgerByCandidate(admin, tenant_id, cand, stockCols);
    if (ledgerRes.error && ledgerRes.fatal) {
      return dbConnJson(503, ledgerRes.error);
    }
    ledgerRow = ledgerRes.row;

    if (!ledgerRow && invRow && stockCols.size > 0) {
      const altFromInv =
        String(invRow.item_code ?? invRow.item_no ?? "").trim() || cand;
      const second = await queryLedgerByCandidate(
        admin,
        tenant_id,
        altFromInv,
        stockCols,
      );
      if (second.error && second.fatal) {
        return dbConnJson(503, second.error);
      }
      ledgerRow = second.row;
    }

    if (ledgerRow || invRow) {
      const inventory = mergeInventory(ledgerRow, invRow, qtyCol);
      const effectiveItemNo =
        String(
          ledgerRow?.item_no ??
            ledgerRow?.item_code ??
            invRow?.item_code ??
            invRow?.item_no ??
            cand,
        ).trim() || cand;

      const syntheticRecord: Record<string, unknown> = {
        id: String(ledgerRow?.id ?? invRow?.id ?? ""),
        tenant_id,
        label_type: "inventory_direct",
        qr_payload: qr_in,
        item_no: effectiveItemNo,
        color_code: null,
        operator_id: null,
        created_at: new Date().toISOString(),
        meta: {
          item_name: inventory.item_name,
          spec: inventory.spec,
          lookup_source: ledgerRow && invRow ? "ledger+inventory_items" : ledgerRow ? "warehouse_ledger_stock" : "inventory_items",
        },
      };

      if (!syntheticRecord.id) {
        return dbConnJson(503, "無法取得 ledger / inventory 的唯一 id");
      }

      return NextResponse.json({
        found: true,
        record: syntheticRecord,
        inventory,
      });
    }
  }

  /** 退路：label_records（舊 QR / UUID） */
  const { row, error } = await pickLabelRow(admin, tenant_id, tryPayloads);
  if (error) {
    return dbConnJson(503, error);
  }

  if (!row) {
    return NextResponse.json({
      found: false,
      tenant_id,
      qr_payload: qr_in,
      message: "查無此料號（inventory_items／warehouse_ledger_stock／label_records 皆未命中）",
    });
  }

  const itemNo = String(row.item_no ?? "").trim();
  const meta = (row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)
    ? (row.meta as Record<string, unknown>)
    : {}) as Record<string, unknown>;

  const ledgerRes = itemNo
    ? await queryLedgerByCandidate(admin, tenant_id, itemNo, stockCols)
    : { row: null, error: null as string | null, fatal: false };
  if (ledgerRes.error && ledgerRes.fatal) {
    return dbConnJson(503, ledgerRes.error ?? undefined);
  }

  const ledgerRow = ledgerRes.row;
  const metaName = String(meta.item_name ?? meta.product_name ?? "").trim();
  const metaSpec = String(meta.spec ?? "").trim();

  const inventory = ledgerRow
    ? mergeInventory(ledgerRow, null, qtyCol)
    : {
        item_name: metaName,
        spec: metaSpec,
        on_hand: 0,
      };

  if (!metaName && !ledgerRow) {
    inventory.item_name = metaName;
    inventory.spec = metaSpec;
  }

  return NextResponse.json({
    found: true,
    record: row,
    inventory: {
      item_name: inventory.item_name || metaName,
      spec: inventory.spec || metaSpec,
      on_hand: inventory.on_hand,
    },
  });
}
