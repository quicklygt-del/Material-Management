import { NextResponse } from "next/server";

import { normalizeLabelPrefix } from "@/lib/labelEncoding";
import { isSuperAdminRequest } from "@/lib/superAdminRequest";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function nextTenantCode(existing: readonly { tenant_code?: string | null }[]) {
  const nums = existing
    .map((x) => parseInt(String(x.tenant_code ?? ""), 10))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 999);
  const mx = nums.length ? Math.max(...nums) : -1;
  const next = mx + 1;
  if (next > 999) return null;
  return String(next).padStart(3, "0");
}

async function uniqueSlug(admin: NonNullable<
  ReturnType<typeof getSupabaseServiceRoleClient>
>, preferred: string) {
  let base =
    normalizeLabelPrefix(preferred) ||
    normalizeLabelPrefix("T999");
  if (!base.length) base = "T999";
  for (let i = 0; i < 48; i += 1) {
    const cand = i === 0 ? base.slice(0, 16) : `${base}${i + 1}`.slice(0, 16);
    const { data } = await admin
      .from("tenants")
      .select("tenant_code")
      .eq("tenant_slug", cand)
      .maybeSingle();
    if (!data) return cand;
  }
  return null;
}

export async function GET() {
  if (!(await isSuperAdminRequest())) {
    return NextResponse.json({ error: "未授權" }, { status: 401 });
  }
  const admin = getSupabaseServiceRoleClient();
  if (!admin) return missingServiceRoleResponse();

  const { data, error } = await admin
    .from("tenants")
    .select(
      "tenant_code,tenant_slug,company_name,status,feature_warehouse_ledger,created_at",
    )
    .order("tenant_code", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ tenants: data ?? [] });
}

export async function POST(req: Request) {
  if (!(await isSuperAdminRequest())) {
    return NextResponse.json({ error: "未授權" }, { status: 401 });
  }
  const admin = getSupabaseServiceRoleClient();
  if (!admin) return missingServiceRoleResponse();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON 格式錯誤" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const companyName = String(b.company_name ?? "").trim();
  if (!companyName) {
    return NextResponse.json({ error: "請填寫 company_name（公司／租戶顯示名稱）" }, { status: 400 });
  }

  const { data: all, error: listErr } = await admin
    .from("tenants")
    .select("tenant_code");
  if (listErr) {
    return NextResponse.json({ error: listErr.message }, { status: 500 });
  }
  const code = nextTenantCode(all ?? []);
  if (!code) {
    return NextResponse.json({ error: "租戶代碼已滿（000–999）" }, { status: 400 });
  }

  const rawSlug =
    typeof b.tenant_slug === "string"
      ? b.tenant_slug
      : `T${code}`;

  const slug = await uniqueSlug(admin, rawSlug);
  if (!slug) {
    return NextResponse.json(
      { error: "無法產生唯一的 tenant_slug" },
      { status: 400 },
    );
  }

  const feature =
    typeof b.feature_warehouse_ledger === "boolean"
      ? b.feature_warehouse_ledger
      : true;

  const ins = await admin.from("tenants").insert({
    tenant_code: code,
    tenant_slug: slug,
    company_name: companyName,
    status: "active",
    feature_warehouse_ledger: feature,
  });
  if (ins.error) {
    return NextResponse.json({ error: ins.error.message }, { status: 500 });
  }

  return NextResponse.json({
    tenant_code: code,
    tenant_slug: slug,
    company_name: companyName,
    feature_warehouse_ledger: feature,
    status: "active",
  });
}
