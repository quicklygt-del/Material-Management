import { NextResponse } from "next/server";
import {
  getDefaultLabelPrefix,
  normalizeLabelPrefix,
} from "@/lib/labelEncoding";
import {
  normLedgerItemNo,
  type WarehouseLedgerDirection,
} from "@/lib/warehouseLedger";
import { applyWarehouseLedgerMove } from "@/lib/warehouseLedgerServer";
import { assertTenantWarehouseLedgerAllowed } from "@/lib/warehouseLedgerTenantGuard";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

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
    normalizeLabelPrefix(String(b.tenant_id ?? getDefaultLabelPrefix())) ||
    getDefaultLabelPrefix();
  const blocked = await assertTenantWarehouseLedgerAllowed(admin, tenantId);
  if (blocked) return blocked;
  const itemNo = normLedgerItemNo(b.item_no);
  const direction = String(b.direction ?? "").trim() as WarehouseLedgerDirection;
  const qty = Number(b.qty);
  const shortageForced = Boolean(b.shortage_forced);
  const ref =
    b.ref && typeof b.ref === "object" && !Array.isArray(b.ref)
      ? (b.ref as Record<string, unknown>)
      : {};

  const extra = {
    order_no: b.order_no != null ? String(b.order_no).trim() : undefined,
    task_id: b.task_id != null ? String(b.task_id).trim() : undefined,
    operator_name: b.operator_name != null ? String(b.operator_name).trim() : undefined,
    scan_payload: b.scan_payload != null ? String(b.scan_payload).trim().slice(0, 240) : undefined,
  };

  if (!itemNo || (direction !== "inbound" && direction !== "outbound")) {
    return NextResponse.json(
      { error: "無效的 item_no 或 direction（需 inbound/outbound）" },
      { status: 400 },
    );
  }

  const mergedRef = {
    ...ref,
    ...(extra.order_no ? { order_no: extra.order_no } : {}),
    ...(extra.task_id ? { task_id: extra.task_id } : {}),
    ...(extra.operator_name ? { operator_name: extra.operator_name } : {}),
    ...(extra.scan_payload ? { scan_payload: extra.scan_payload } : {}),
  };

  const r = await applyWarehouseLedgerMove(admin, {
    tenantId,
    itemNo,
    direction,
    qty,
    shortageForced,
    ref: mergedRef,
    seedItemName:
      typeof b.seed_item_name === "string" ? b.seed_item_name : undefined,
    seedSpec: typeof b.seed_spec === "string" ? b.seed_spec : undefined,
  });

  if (!r.ok) {
    return NextResponse.json({ error: r.error }, { status: 400 });
  }

  return NextResponse.json({
    accepted: true,
    balance_after: r.balance_after,
  });
}
