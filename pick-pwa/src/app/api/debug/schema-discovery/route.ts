import { NextResponse } from "next/server";
import {
  extractSupabaseProjectRef,
  fetchPublicTableColumns,
  isPlausibleServiceRoleKey,
  maskSecret,
} from "@/lib/supabaseSchemaDiscovery";
import {
  getDefaultLabelPrefix,
  normalizeLabelPrefix,
} from "@/lib/labelEncoding";
import { getSupabaseServiceRoleClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/**
 * 診斷：環境變數中的專案 ref、service_role 是否像有效 JWT、
 * public.warehouse_ledger_stock / inventory_items 欄位列表。
 * 勿在正式環境對外公開此路由（必要時請加 IP 限制或移除）。
 */
export async function GET(req: Request) {
  const urlEnv =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ??
    process.env.SUPABASE_URL?.trim() ??
    "";
  const roleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_KEY ??
    "";

  const projectRef = extractSupabaseProjectRef(urlEnv);
  const admin = getSupabaseServiceRoleClient();

  const urlObj = new URL(req.url);
  const tenantHint =
    normalizeLabelPrefix(urlObj.searchParams.get("tenant") ?? "") ||
    getDefaultLabelPrefix();

  const envReport = {
    supabase_url_host: urlEnv ? new URL(urlEnv).hostname : null,
    project_ref_from_url: projectRef,
    next_public_supabase_url_set: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL?.trim(),
    ),
    supabase_url_fallback_set: Boolean(process.env.SUPABASE_URL?.trim()),
    service_role_configured: Boolean(roleKey.trim()),
    service_role_looks_valid_jwt: isPlausibleServiceRoleKey(),
    service_role_preview: maskSecret(roleKey),
    tenant_hint: tenantHint || null,
  };

  if (!admin) {
    return NextResponse.json(
      {
        error: "Database Connection Error",
        message_zh:
          "缺少 NEXT_PUBLIC_SUPABASE_URL／SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY。",
        env: envReport,
        tables: null,
      },
      { status: 503 },
    );
  }

  const stock = await fetchPublicTableColumns(
    admin,
    "warehouse_ledger_stock",
  );
  const items = await fetchPublicTableColumns(admin, "inventory_items");

  const connectivity = await admin
    .from("warehouse_ledger_stock")
    .select("id")
    .limit(1);
  const connectivityOk = !connectivity.error;

  return NextResponse.json({
    ok: connectivityOk,
    error: connectivityOk ? undefined : "Database Connection Error",
    connectivity_detail: connectivity.error?.message,
    env: envReport,
    tables: {
      warehouse_ledger_stock: stock,
      inventory_items: items,
    },
  });
}
