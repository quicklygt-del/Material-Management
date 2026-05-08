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

/** 消耗邀請令牌（印在 QR），建立與登入同等之 Cookie */
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
  const raw = String((body as Record<string, unknown>).token ?? "").trim();
  if (!raw) {
    return NextResponse.json({ error: "缺少 token" }, { status: 400 });
  }

  const nowIso = new Date().toISOString();
  const szCol = getStorageZonesScopeColumn();
  const { data: zones, error } = await admin
    .from("storage_zones")
    .select(`id,name,slug,${szCol},invite_token,invite_expires_at`)
    .eq("invite_token", raw);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const row = (zones ?? []).find((z) => {
    const exp = z.invite_expires_at as string | null;
    if (!exp) return true;
    return exp > nowIso;
  });
  if (!row?.slug) {
    return NextResponse.json({ error: "邀請無效或已過期" }, { status: 401 });
  }

  const jwt = await signUnitJwt(
    String(row.id),
    {
      slug: String(row.slug),
      tenant: normalizeLabelPrefix(
        zoneRowScopeValue(
          row as { tenant_id?: unknown; company_id?: unknown },
        ) || getDefaultLabelPrefix(),
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

  return NextResponse.json({ ok: true, slug: row.slug });
}
