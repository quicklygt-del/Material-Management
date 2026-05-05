import type { NextResponse } from "next/server";
import { NextResponse as NR } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizeLabelPrefix } from "@/lib/labelEncoding";

/**
 * 若 tenants 表無此 slug（舊庫未建租戶），不阻擋；有列且停用／關閉總帳則拒絕。
 */
export async function assertTenantWarehouseLedgerAllowed(
  admin: SupabaseClient,
  tenantSlug: string,
): Promise<NextResponse | null> {
  const slug = normalizeLabelPrefix(tenantSlug);
  if (!slug) {
    return NR.json({ error: "無效的 tenant" }, { status: 400 });
  }
  const { data, error } = await admin
    .from("tenants")
    .select("status, feature_warehouse_ledger")
    .eq("tenant_slug", slug)
    .maybeSingle();
  if (error) {
    if (/relation.*tenants|does not exist/i.test(error.message)) {
      return null;
    }
    return NR.json({ error: error.message }, { status: 500 });
  }
  if (!data) return null;
  if (String(data.status ?? "") !== "active") {
    return NR.json({ error: "此租戶已停用" }, { status: 403 });
  }
  if (data.feature_warehouse_ledger === false) {
    return NR.json({ error: "此租戶未開啟倉儲總帳模組" }, { status: 403 });
  }
  return null;
}
