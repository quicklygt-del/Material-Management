import { NextResponse } from "next/server";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/**
 * 倉儲後台：app_users 中 role=warehouse_admin 的帳密。
 * 與 username=admin 的系統管理員分流。
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

  const { data, error } = await adminClient
    .from("app_users")
    .select("id,username,role")
    .eq("username", username)
    .eq("role", "warehouse_admin")
    .eq("password", pwd)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: `登入查詢失敗：${error.message}` },
      { status: 500 },
    );
  }
  if (!data) {
    return NextResponse.json({ error: "帳號或密碼錯誤" }, { status: 401 });
  }

  return NextResponse.json({
    id: String(data.id),
    username: String(data.username),
    role: "warehouse_admin",
  });
}
