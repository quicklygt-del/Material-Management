import { NextResponse } from "next/server";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/**
 * 管理員以 app_users（username=admin）驗證。
 * 使用 service role 查詢，避免瀏覽器 anon 在某些 RLS／部署設定下讀不到資料列。
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
  const pwd = String((body as { password?: unknown }).password ?? "");
  if (!pwd.trim()) {
    return NextResponse.json({ error: "請輸入密碼" }, { status: 400 });
  }

  const { data, error } = await adminClient
    .from("app_users")
    .select("id,username,role")
    .eq("username", "admin")
    .in("role", ["admin", "system_admin"])
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
    username: "admin",
    role: "system_admin",
  });
}
