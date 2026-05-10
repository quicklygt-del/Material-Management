import { NextResponse } from "next/server";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";

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

/** 首頁登入帳號清單 */
export async function GET() {
  const adminClient = getSupabaseServiceRoleClient();
  if (!adminClient) {
    return missingServiceRoleResponse();
  }

  const seen = new Set<string>();

  const { data: appRows, error: appErr } = await adminClient
    .from("app_users")
    .select("username,role")
    .in("role", ["admin", "system_admin", "warehouse_admin"]);

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
    .eq("active", true);

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
    .select("portal_login");

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

  return NextResponse.json({ usernames });
}
