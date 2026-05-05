import { NextResponse } from "next/server";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";
import { normalizeRole } from "@/lib/auth";
import {
  getDefaultLabelPrefix,
  normalizeLabelPrefix,
} from "@/lib/labelEncoding";

export const dynamic = "force-dynamic";

async function tenantLoginBlocked(
  admin: NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>,
  companyIdRaw: string,
): Promise<string | null> {
  const slug =
    normalizeLabelPrefix(companyIdRaw) ||
    normalizeLabelPrefix(getDefaultLabelPrefix());
  const { data, error } = await admin
    .from("tenants")
    .select("status")
    .eq("tenant_slug", slug)
    .maybeSingle();
  if (error) {
    if (/relation.*tenants|does not exist/i.test(error.message)) {
      return null;
    }
    return `租戶狀態查詢失敗：${error.message}`;
  }
  if (!data) return null;
  if (String(data.status ?? "") !== "active") {
    return "此租戶已停用，無法登入";
  }
  return null;
}

/**
 * 單一帳密：app_users（倉儲主管／系統管理）或 warehouse_operators（倉管員）。
 * 依 company_id 帶出租戶 slug（tenant_slug），供前端隔離資料。
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
    .select("id,username,role,company_id")
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
    const companyId = String(
      (appRow as { company_id?: string }).company_id ?? "",
    ).trim();
    const tenant_slug =
      normalizeLabelPrefix(companyId) ||
      normalizeLabelPrefix(getDefaultLabelPrefix());
    const block = await tenantLoginBlocked(adminClient, companyId);
    if (block) {
      return NextResponse.json({ error: block }, { status: 403 });
    }
    return NextResponse.json({
      id: String(appRow.id),
      username: String(appRow.username),
      role,
      tenant_slug,
    });
  }

  const { data: op, error: opErr } = await adminClient
    .from("warehouse_operators")
    .select("id,name,active,password,company_id")
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

  const companyId = String((op as { company_id?: string }).company_id ?? "").trim();
  const tenant_slug =
    normalizeLabelPrefix(companyId) ||
    normalizeLabelPrefix(getDefaultLabelPrefix());
  const block = await tenantLoginBlocked(adminClient, companyId);
  if (block) {
    return NextResponse.json({ error: block }, { status: 403 });
  }

  return NextResponse.json({
    id: String(op.id),
    username: String(op.name),
    role: "warehouse_staff",
    tenant_slug,
  });
}
