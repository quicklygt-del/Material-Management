import { NextResponse } from "next/server";
import {
  getDefaultLabelPrefix,
  normalizeLabelPrefix,
} from "@/lib/labelEncoding";
import { normLedgerItemNo } from "@/lib/warehouseLedger";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";
import { assertTenantWarehouseLedgerAllowed } from "@/lib/warehouseLedgerTenantGuard";

export const dynamic = "force-dynamic";

type RowIn = {
  item_no?: unknown;
  item_name?: unknown;
  spec?: unknown;
  on_hand?: unknown;
  attrs?: unknown;
};

const MAX_BATCH = 1200;

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
  const tenantId =
    normalizeLabelPrefix(String(b. ?? getDefaultLabelPrefix())) ||
    getDefaultLabelPrefix();

  const denied = await assertTenantWarehouseLedgerAllowed(admin, tenantId);
  if (denied) return denied;

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
  type UpsertRow = {
    : string;
    item_no: string;
    item_name: string;
    spec: string;
    on_hand: number;
    attrs: Record<string, unknown>;
    updated_at: string;
  };

  const acc = new Map<string, UpsertRow>();

  const mergeAttrs = (
    prev: Record<string, unknown>,
    incoming: unknown,
  ): Record<string, unknown> => {
    if (incoming && typeof incoming === "object" && !Array.isArray(incoming)) {
      return { ...prev, ...(incoming as Record<string, unknown>) };
    }
    return prev;
  };

  for (const raw of rowsIn) {
    const item_no = normLedgerItemNo(raw.item_no);
    if (!item_no) continue;
    const item_name =
      typeof raw.item_name === "string"
        ? raw.item_name.trim().slice(0, 500)
        : "";
    const spec =
      typeof raw.spec === "string" ? raw.spec.trim().slice(0, 500) : "";
    const onHandRaw = Number(raw.on_hand);
    const on_hand = Number.isFinite(onHandRaw)
      ? Math.floor(onHandRaw)
      : NaN;

    const attrs = mergeAttrs({}, raw.attrs);

    const cur =
      acc.get(item_no) ??
      ({
        : tenantId,
        item_no,
        item_name: "",
        spec: "",
        on_hand: 0,
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
        { error: `料號 ${item_no}：on_hand 非有效數字` },
        { status: 400 },
      );
    }
    cur.on_hand = on_hand;
    cur.updated_at = iso;

    acc.set(item_no, cur);
  }

  const payload = Array.from(acc.values());
  if (!payload.length) {
    return NextResponse.json({ error: "無有效列（均需料號）" }, { status: 400 });
  }

  const { error } = await admin.from("warehouse_ledger_stock").upsert(payload, {
    onConflict: ",item_no",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, upserted: payload.length, : tenantId });
}
