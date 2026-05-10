import { NextResponse } from "next/server";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";
import { normalizeRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * 單一帳密：app_users（倉儲主管／系統管理）或 warehouse_operators（倉管員）。
 * 單機模式。
 */
export async function POST(req: Request) {
  const adminClient = getSupabaseServiceRoleClient();
  if (!adminClient) {
    return missingServiceRoleResponse();
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON 格式錯誤" }, { status: 400 });
  }
  const username = String(
    (body as { username?: unknown }).username ?? "",
  ).trim();
  const pwd = String((body as { password?: unknown }).password ?? "");
  if (!username || !pwd.trim()) {
    return NextResponse.json(
      { error: "請輸入帳號與密碼" },
      { status: 400 },
    );
  }

  const { data: appRow, error: appErr } = await adminClient
    .from("app_users")
    .select("id,username,role")
    .eq("username", username)
    .eq("password", pwd)
    .maybeSingle();

  if (appErr) {
    return NextResponse.json(
      { error: `登入查詢失敗：${appErr.message}` },
      { status: 500 },
    );
  }

  if (appRow) {
    const role = normalizeRole(String(appRow.role ?? ""));
    if (!role) {
      return NextResponse.json({ error: "帳號或密碼錯誤" }, { status: 401 });
    }
    return NextResponse.json({
      id: String(appRow.id),
      username: String(appRow.username),
      role,
    });
  }

  const { data: op, error: opErr } = await adminClient
    .from("warehouse_operators")
    .select("id,name,active,password")
    .eq("name", username)
    .eq("active", true)
    .eq("password", pwd)
    .limit(1)
    .maybeSingle();

  if (opErr) {
    return NextResponse.json(
      { error: `登入查詢失敗：${opErr.message}` },
      { status: 500 },
    );
  }

  if (!op) {
    return NextResponse.json({ error: "帳號或密碼錯誤" }, { status: 401 });
  }

  return NextResponse.json({
    id: String(op.id),
    username: String(op.name),
    role: "warehouse_staff",
  });
}
