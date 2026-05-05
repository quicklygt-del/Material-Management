import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";
import { normalizeLabelPrefix } from "@/lib/labelEncoding";
import {
  getDefaultLabelTemplateFields,
  normalizeLabelTemplateFields,
  type LabelTemplateField,
} from "@/lib/labelPrintTemplate";
import { verifyUnitJwt, UNIT_JWT_COOKIE } from "@/lib/unitPortalJwt";

export const dynamic = "force-dynamic";

/** 解析 Cookie 並校驗單位仍存在 */
export async function GET() {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) {
    return missingServiceRoleResponse();
  }
  const token = (await cookies()).get(UNIT_JWT_COOKIE)?.value;
  if (!token) {
    return NextResponse.json({ error: "未登入" }, { status: 401 });
  }
  const v = await verifyUnitJwt(token);
  if (!v) {
    return NextResponse.json({ error: "工作階段無效" }, { status: 401 });
  }
  const tenant = normalizeLabelPrefix(v.tenant);
  const sel = await admin
    .from("storage_zones")
    .select("id,name,slug,tenant_id,portal_login,label_template_id")
    .eq("id", v.unitId)
    .maybeSingle();

  let z = sel.data;
  let selErr = sel.error;

  if (selErr?.message && /label_template_id|42703|column/i.test(selErr.message)) {
    const fb = await admin
      .from("storage_zones")
      .select("id,name,slug,tenant_id,portal_login")
      .eq("id", v.unitId)
      .maybeSingle();
    z = fb.data as typeof z;
    selErr = fb.error;
  }

  if (selErr || !z) {
    return NextResponse.json({ error: "單位不存在" }, { status: 401 });
  }
  const zslug = String(z.slug ?? "").trim();
  const ztenant = normalizeLabelPrefix(String(z.tenant_id));
  if (zslug !== v.slug || ztenant !== tenant) {
    return NextResponse.json({ error: "身分與資料庫不符" }, { status: 401 });
  }

  const rawTid = (z as { label_template_id?: string | null }).label_template_id;
  let label_template: {
    id: string;
    name: string;
    fields: LabelTemplateField[];
  } | null = null;

  const tid = rawTid != null ? String(rawTid).trim() : "";
  if (tid) {
    const tr = await admin
      .from("label_print_templates")
      .select("id,name,field_definitions")
      .eq("id", tid)
      .eq("tenant_id", normalizeLabelPrefix(String(z.tenant_id)))
      .maybeSingle();
    const row = tr.data as
      | { id?: string; name?: string; field_definitions?: unknown }
      | undefined;
    if (!tr.error && row?.id && row.field_definitions != null) {
      const norm = normalizeLabelTemplateFields(row.field_definitions);
      if (norm) {
        label_template = {
          id: String(row.id),
          name: String(row.name ?? "").trim() || "範本",
          fields: norm,
        };
      }
    }
  }

  const label_fields =
    label_template && label_template.fields.length > 0
      ? label_template.fields
      : getDefaultLabelTemplateFields();

  return NextResponse.json({
    unit_id: v.unitId,
    slug: v.slug,
    name: String(z.name ?? "").trim(),
    tenant_id: tenant,
    portal_login: String(z.portal_login ?? "").trim(),
    label_template_id: tid || null,
    label_template: label_template
      ? {
          id: label_template.id,
          name: label_template.name,
          fields: label_template.fields,
        }
      : null,
    /** 無有效綁定時與舊版相容（四欄預設） */
    label_fields,
  });
}
