import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import {
  getDefaultLabelPrefix,
  normalizeLabelPrefix,
} from "@/lib/labelEncoding";
import { slugifyUnitBase } from "@/lib/unitSlug";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";
import {
  getStorageZonesScopeColumn,
  storageZonesSelectFull,
  storageZonesSelectIdScope,
  storageZonesSelectNoLabelTemplate,
  storageZonesSelectPatch,
  zoneRowScopeValue,
} from "@/lib/storageZonesScope";

export const dynamic = "force-dynamic";

const MAX_WAREHOUSES = 5;

function sanitizeSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
}

async function templateBelongsToTenant(
  admin: NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>,
  : string,
  templateId: string | null | undefined,
): Promise<boolean> {
  const tid = String(templateId ?? "").trim();
  if (!tid) return true;
  const { data, error } = await admin
    .from("label_print_templates")
    .select("id")
    .eq("", )
    .eq("id", tid)
    .maybeSingle();
  if (error) return false;
  return Boolean(data);
}

async function slugIsFree(
  admin: NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>,
  : string,
  candidate: string,
): Promise<boolean> {
  const scopeCol = getStorageZonesScopeColumn();
  const { data, error } = await admin
    .from("storage_zones")
    .select("id")
    .eq(scopeCol, )
    .eq("slug", candidate)
    .limit(1);
  if (error) return false;
  return !(data?.length ?? 0);
}

async function allocateUniqueSlug(
  admin: NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>,
  : string,
  preferred: string,
): Promise<string> {
  const base =
    sanitizeSlug(preferred) ||
    sanitizeSlug(slugifyUnitBase(preferred)) ||
    `zone-${randomBytes(4).toString("hex")}`;
  const root = base || `unit-${randomBytes(3).toString("hex")}`;

  for (let i = 0; i < 72; i += 1) {
    const candidate =
      i === 0
        ? root.slice(0, 56)
        : `${root.slice(0, 36)}-${randomBytes(6).toString("hex")}`.slice(
            0,
            56,
          );
    if (await slugIsFree(admin, , candidate)) return candidate;
  }
  return `u-${randomBytes(16).toString("hex")}`.slice(0, 56);
}

function normalizeDbError(insertErr: {
  message?: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}): string {
  const raw =
    `${insertErr.message ?? ""} ${insertErr.details ?? ""} ${insertErr.hint ?? ""}`.toLowerCase();
  if (insertErr.code === "23505" || raw.includes("duplicate")) {
    if (
      raw.includes("portal_login") ||
      raw.includes("idx_storage_zones_tenant_portal")
    ) {
      return "此「登入帳號」在貴公司已存在，請改用其他帳號。";
    }
    if (
      raw.includes("slug") ||
      raw.includes("tenant_slug") ||
      raw.includes("(, slug)") ||
      raw.includes("(company_id, slug)")
    ) {
      return "路徑 slug 與現有單位衝突，請在表單手填不重複英數 slug 或稍後再試。";
    }
    return "資料重複無法新增（帳號或路徑與資料庫衝突）。請更換「登入帳號」，或留白「路徑 slug」交由系統產生。";
  }
  if (insertErr.code === "42703" || raw.includes("column") ||
    raw.includes("does not exist")) {
    return "資料表缺欄位（例如 slug、portal_login）；請於 Supabase 執行 other_operations_portal_v018.sql 或 install_universal_bin_card_system 相關欄位後再試。";
  }
  return insertErr.message || "資料庫寫入失敗";
}

export async function GET(req: Request) {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) {
    return missingServiceRoleResponse();
  }
  const url = new URL(req.url);
  const fromQuery = normalizeLabelPrefix(url.searchParams.get("tenant") ?? "");
  const  = fromQuery || getDefaultLabelPrefix();
  const scopeCol = getStorageZonesScopeColumn();
  const { data, error } = await admin
    .from("storage_zones")
    .select(storageZonesSelectFull())
    .eq(scopeCol, )
    .order("created_at", { ascending: true });
  if (error) {
    const em = error.message ?? "";
    const fallback =
      /label_template_id|column|42703/i.test(em)
        ? admin
            .from("storage_zones")
            .select(storageZonesSelectNoLabelTemplate())
            .eq(scopeCol, )
            .order("created_at", { ascending: true })
        : null;
    if (fallback) {
      const fr = await fallback;
      if (!fr.error) {
        const zones = (fr.data ?? []).map((z) => {
          const row = z as unknown as Record<string, unknown>;
          const scopeVal = zoneRowScopeValue(
            row as { ?: unknown; company_id?: unknown },
          );
          return {
            ...row,
            : scopeVal,
            label_template_id: null as string | null,
            name: String(row.name ?? "").trim() || "未命名",
            slug: String(row.slug ?? "").trim(),
            portal_login: String(row.portal_login ?? "").trim(),
          };
        });
        return NextResponse.json({
          storage_zones: zones,
          warehouses: zones,
        });
      }
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const zones = (data ?? []).map((z) => {
    const row = z as unknown as Record<string, unknown>;
    const scopeVal = zoneRowScopeValue(
      row as { ?: unknown; company_id?: unknown },
    );
    return {
      ...row,
      : scopeVal,
      name: String(row.name ?? "").trim() || "未命名",
      slug: String(row.slug ?? "").trim(),
      portal_login: String(row.portal_login ?? "").trim(),
      label_template_id:
        (row.label_template_id as string | null | undefined) ?? null,
    };
  });
  return NextResponse.json({
    storage_zones: zones,
    warehouses: zones,
  });
}

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
  const  =
    normalizeLabelPrefix(String(b. ?? "")) || getDefaultLabelPrefix();
  const name = String(b.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "缺少單位名稱" }, { status: 400 });
  }
  const scopeCol = getStorageZonesScopeColumn();
  const { data: tenantZones, error: cErr } = await admin
    .from("storage_zones")
    .select("id")
    .eq(scopeCol, );
  if (cErr) {
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }
  if ((tenantZones?.length ?? 0) >= MAX_WAREHOUSES) {
    return NextResponse.json(
      { error: `每公司最多 ${MAX_WAREHOUSES} 個作業單位` },
      { status: 400 },
    );
  }

  const portal_login = String(b.portal_login ?? "").trim();
  const portal_password = String(b.portal_password ?? "");
  if (!portal_login) {
    return NextResponse.json({ error: "請輸入登入帳號" }, { status: 400 });
  }
  /** 門禁憑證由管理員自定，不要求強密碼；空白則拒絕 */
  if (!portal_password.trim()) {
    return NextResponse.json({ error: "請輸入登入密碼" }, { status: 400 });
  }

  let label_template_id: string | null =
    b.label_template_id === null || b.label_template_id === ""
      ? null
      : String(b.label_template_id).trim() || null;
  if (label_template_id) {
    const okT = await templateBelongsToTenant(admin, , label_template_id);
    if (!okT) {
      return NextResponse.json(
        { error: "標籤範本不存在或不屬於本公司" },
        { status: 400 },
      );
    }
  } else {
    label_template_id = null;
  }

  const slugHint = String(b.slug ?? "").trim();
  const preferred =
    sanitizeSlug(slugHint) ||
    sanitizeSlug(portal_login) ||
    sanitizeSlug(slugifyUnitBase(name)) ||
    slugifyUnitBase(name) ||
    name;
  let slugAlloc = await allocateUniqueSlug(admin, , preferred);

  /** insert 瞬間若有 race 撞上 unique(slug)，改隨機 slug 重試數次 */
  let data: Record<string, unknown> | null = null;
  let lastInsertErr: Parameters<typeof normalizeDbError>[0] | null = null;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const trySlug =
      attempt === 0
        ? slugAlloc
        : `z-${randomBytes(10).toString("hex")}`.slice(0, 56);

    const insertRow: Record<string, unknown> = {
      name,
      slug: trySlug,
      portal_login: portal_login.slice(0, 64),
      portal_password: portal_password.trim(),
      ...(label_template_id ? { label_template_id } : {}),
    };
    insertRow[scopeCol] = ;

    const ins = await admin
      .from("storage_zones")
      .insert(insertRow)
      .select(storageZonesSelectFull())
      .single();

    if (!ins.error && ins.data) {
      data = ins.data as unknown as Record<string, unknown>;
      break;
    }

    lastInsertErr = ins.error as Parameters<typeof normalizeDbError>[0];

    const isDup =
      ins.error?.code === "23505" ||
      String(ins.error?.message ?? "").toLowerCase().includes("duplicate");
    const raw =
      `${ins.error?.message ?? ""}${ins.error?.details ?? ""}`.toLowerCase();
    const slugFight =
      isDup &&
      (raw.includes("slug") ||
        raw.includes("(, slug)") ||
        raw.includes("(company_id, slug)") ||
        raw.includes("tenant_slug"));

    if (slugFight) {
      slugAlloc = trySlug;
      continue;
    }
    /** 同一帳號重複或非 slug 之重複不重試 */
    break;
  }

  if (!data) {
    return NextResponse.json(
      { error: normalizeDbError(lastInsertErr ?? { message: "新增失敗" }) },
      { status: lastInsertErr?.code === "23505" ? 409 : 500 },
    );
  }

  const w = data as unknown as Record<string, unknown>;
  return NextResponse.json({
    warehouse: {
      ...w,
      : zoneRowScopeValue(
        w as { ?: unknown; company_id?: unknown },
      ),
    },
  });
}

export async function PATCH(req: Request) {
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
  const id = String(b.id ?? "");
  const tenant_q =
    normalizeLabelPrefix(String(b. ?? "")) || getDefaultLabelPrefix();

  if (!id) {
    return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  }

  const scopeColPatch = getStorageZonesScopeColumn();
  const { data: existing, error: exErr } = await admin
    .from("storage_zones")
    .select(storageZonesSelectPatch())
    .eq("id", id)
    .maybeSingle();
  if (exErr || !existing) {
    return NextResponse.json({ error: "找不到單位" }, { status: 404 });
  }
  if (
    normalizeLabelPrefix(
      zoneRowScopeValue(
        existing as { ?: unknown; company_id?: unknown },
      ),
    ) !== tenant_q
  ) {
    return NextResponse.json({ error: "租戶不符" }, { status: 403 });
  }

  type Patch = Record<string, string | null | undefined>;
  const patch: Patch = {};

  if ("name" in b) {
    const name = String(b.name ?? "").trim();
    if (!name) {
      return NextResponse.json({ error: "名稱不可為空" }, { status: 400 });
    }
    patch.name = name;
  }

  if ("slug" in b) {
    const want = sanitizeSlug(String(b.slug ?? ""));
    if (!want) {
      return NextResponse.json({ error: "slug 無效" }, { status: 400 });
    }
    if (want !== String((existing as unknown as Record<string, unknown>).slug ?? "").trim()) {
      const { count } = await admin
        .from("storage_zones")
        .select("id", { count: "exact", head: true })
        .eq(scopeColPatch, tenant_q)
        .eq("slug", want)
        .neq("id", id);
      if ((count ?? 0) > 0) {
        return NextResponse.json({ error: "slug 已被使用" }, { status: 409 });
      }
      patch.slug = want;
    }
  }

  if ("portal_login" in b) {
    patch.portal_login = String(b.portal_login ?? "").trim().slice(0, 64);
  }

  if ("portal_password" in b) {
    patch.portal_password = String(b.portal_password ?? "");
  }

  if ("label_template_id" in b) {
    const raw = b.label_template_id;
    const lid =
      raw === null || raw === ""
        ? null
        : String(raw).trim() || null;
    if (lid) {
      const okT = await templateBelongsToTenant(admin, tenant_q, lid);
      if (!okT) {
        return NextResponse.json(
          { error: "標籤範本不存在或不屬於本公司" },
          { status: 400 },
        );
      }
    }
    patch.label_template_id = lid;
  }

  let newInviteToken: string | null = null;
  if (b.regenerate_invite === true) {
    newInviteToken = randomBytes(27).toString("base64url");
    patch.invite_token = newInviteToken;
    patch.invite_expires_at = new Date(
      Date.now() + 1000 * 60 * 60 * 24 * 30,
    ).toISOString();
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "無更新欄位" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("storage_zones")
    .update(patch)
    .eq("id", id)
    .select(storageZonesSelectFull())
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const w = data as unknown as Record<string, unknown>;
  return NextResponse.json({
    warehouse: {
      ...w,
      : zoneRowScopeValue(
        w as { ?: unknown; company_id?: unknown },
      ),
    },
    ...(newInviteToken ? { invite_token: newInviteToken } : {}),
  });
}

export async function DELETE(req: Request) {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) {
    return missingServiceRoleResponse();
  }
  const url = new URL(req.url);
  const id = url.searchParams.get("id")?.trim();
  const  =
    normalizeLabelPrefix(url.searchParams.get("tenant") ?? "") ||
    getDefaultLabelPrefix();
  if (!id) {
    return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  }

  const scopeDel = getStorageZonesScopeColumn();
  const { data: zone, error: zErr } = await admin
    .from("storage_zones")
    .select(storageZonesSelectIdScope())
    .eq("id", id)
    .maybeSingle();
  if (zErr || !zone) {
    return NextResponse.json({ error: "找不到管理單位" }, { status: 404 });
  }
  if (
    normalizeLabelPrefix(
      zoneRowScopeValue(zone as { ?: unknown; company_id?: unknown }),
    ) !== 
  ) {
    return NextResponse.json({ error: "無權限刪除此單位" }, { status: 403 });
  }

  const { error } = await admin.from("storage_zones").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
