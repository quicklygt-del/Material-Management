import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  getDefaultLabelPrefix,
  normalizeLabelPrefix,
} from "@/lib/labelEncoding";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";
import { signUnitJwt, UNIT_JWT_COOKIE } from "@/lib/unitPortalJwt";
import {
  getStorageZonesScopeColumn,
  zoneRowScopeValue,
} from "@/lib/storageZonesScope";

export const dynamic = "force-dynamic";

const COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 14;

/** 單位員工門禁登入 → 發 httpOnly JWT Cookie */
export async function POST(req: Request) {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) {
    return missingServiceRoleResponse();
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON 格式錯誤" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const tenant_id =
    normalizeLabelPrefix(String(b.tenant_id ?? "")) || getDefaultLabelPrefix();
  const portal_login = String(b.portal_login ?? "").trim();
  const password = String(b.password ?? "");
  if (!portal_login || !password) {
    return NextResponse.json({ error: "請輸入單位帳號與密碼" }, { status: 400 });
  }

  const szCol = getStorageZonesScopeColumn();
  const { data: row, error } = await admin
    .from("storage_zones")
    .select(
      `id,name,slug,${szCol},portal_login,portal_password`,
    )
    .eq(szCol, tenant_id)
    .eq("portal_login", portal_login)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!row || String(row.portal_password ?? "") !== password) {
    return NextResponse.json({ error: "帳號或密碼錯誤" }, { status: 401 });
  }
  const slug = String(row.slug ?? "").trim();
  if (!slug) {
    return NextResponse.json(
      { error: "此單位尚未設定 path slug，請聯絡管理員" },
      { status: 400 },
    );
  }

  const jwt = await signUnitJwt(
    String(row.id),
    {
      slug,
      tenant: normalizeLabelPrefix(
        zoneRowScopeValue(
          row as { tenant_id?: unknown; company_id?: unknown },
        ),
      ),
      name: String(row.name ?? "").trim() || "單位",
    },
    COOKIE_MAX_AGE_SEC,
  );

  const cookieStore = await cookies();
  cookieStore.set(UNIT_JWT_COOKIE, jwt, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SEC,
  });

  return NextResponse.json({ ok: true, slug });
}
