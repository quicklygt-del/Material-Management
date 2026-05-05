import { NextResponse } from "next/server";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";
import {
  getDefaultLabelPrefix,
  normalizeLabelPrefix,
} from "@/lib/labelEncoding";

export const dynamic = "force-dynamic";

function sortUsernames(usernames: string[]): string[] {
  const u = Array.from(
    new Set(usernames.map((x) => x.trim()).filter(Boolean)),
  );
  u.sort((a, b) => {
    if (a === "admin") return -1;
    if (b === "admin") return 1;
    return a.localeCompare(b, "zh-Hant");
  });
  return u;
}

/**
 * 首頁登入帳號清單（依租戶篩選）：
 * app_users、warehouse_operators（company_id）、storage_zones.portal_login（tenant_id）。
 */
export async function GET(req: Request) {
  const adminClient = getSupabaseServiceRoleClient();
  if (!adminClient) {
    return missingServiceRoleResponse();
  }

  const url = new URL(req.url);
  const tenantParam = url.searchParams.get("tenant")?.trim() ?? "";
  const tenantId =
    normalizeLabelPrefix(tenantParam) ||
    normalizeLabelPrefix(getDefaultLabelPrefix());
  const seen = new Set<string>();

  const { data: appRows, error: appErr } = await adminClient
    .from("app_users")
    .select("username,role,company_id")
    .in("role", ["admin", "system_admin", "warehouse_admin"])
    .eq("company_id", tenantId);

  if (appErr) {
    return NextResponse.json(
      { error: `讀取管理帳號失敗：${appErr.message}` },
      { status: 500 },
    );
  }

  for (const row of appRows ?? []) {
    const u = String(row.username ?? "").trim();
    if (u) seen.add(u);
  }

  const { data: opRows, error: opErr } = await adminClient
    .from("warehouse_operators")
    .select("name")
    .eq("active", true)
    .eq("company_id", tenantId);

  if (opErr) {
    return NextResponse.json(
      { error: `讀取倉管員失敗：${opErr.message}` },
      { status: 500 },
    );
  }

  for (const row of opRows ?? []) {
    const name = String(row.name ?? "").trim();
    if (name) seen.add(name);
  }

  const { data: zoneRows, error: zoneErr } = await adminClient
    .from("storage_zones")
    .select("portal_login")
    .eq("tenant_id", tenantId);

  if (zoneErr) {
    return NextResponse.json(
      { error: `讀取作業單位失敗：${zoneErr.message}` },
      { status: 500 },
    );
  }

  for (const row of zoneRows ?? []) {
    const pl = String(row.portal_login ?? "").trim();
    if (pl) seen.add(pl);
  }

  const usernames = sortUsernames(Array.from(seen));

  return NextResponse.json({ usernames, tenant: tenantId });
}
