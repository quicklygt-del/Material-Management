import { NextResponse } from "next/server";

import { normalizeLabelPrefix } from "@/lib/labelEncoding";
import { isSuperAdminRequest } from "@/lib/superAdminRequest";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function nextNumericCode(existing: readonly { _code?: string | null }[]) {
  const nums = existing
    .map((x) => parseInt(String(x._code ?? ""), 10))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 999);
  const mx = nums.length ? Math.max(...nums) : -1;
  const next = mx + 1;
  if (next > 999) return null;
  return String(next).padStart(3, "0");
}

async function uniquePublicSlug(
  admin: NonNullable<ReturnType<typeof getSupabaseServiceRoleClient>>,
  preferred: string,
) {
  let base = normalizeLabelPrefix(preferred) || normalizeLabelPrefix("T999");
  if (!base.length) base = "T999";
  for (let i = 0; i < 48; i += 1) {
    const cand = i === 0 ? base.slice(0, 16) : `${base}${i + 1}`.slice(0, 16);
    const { data } = await admin
      .from("s")
      .select("_code")
      .eq("_slug", cand)
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
    .from("s")
    .select(
      "_code,_slug,company_name,status,feature_warehouse_ledger,created_at",
    )
    .order("_code", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const entries = (data ?? []).map((r) => ({
    numeric_code: String((r as { _code?: string })._code ?? ""),
    public_slug: String((r as { _slug?: string })._slug ?? ""),
    company_name: String((r as { company_name?: string }).company_name ?? ""),
    status: (r as { status?: string }).status,
    feature_warehouse_ledger: (r as { feature_warehouse_ledger?: boolean })
      .feature_warehouse_ledger,
    created_at: (r as { created_at?: string }).created_at,
  }));
  return NextResponse.json({ entries });
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
    return NextResponse.json({ error: "請填寫 company_name（顯示名稱）" }, { status: 400 });
  }

  const { data: all, error: listErr } = await admin.from("s").select("_code");
  if (listErr) {
    return NextResponse.json({ error: listErr.message }, { status: 500 });
  }
  const code = nextNumericCode(all ?? []);
  if (!code) {
    return NextResponse.json({ error: "代碼已滿（000–999）" }, { status: 400 });
  }

  const rawSlug =
    typeof b.public_slug === "string" ? b.public_slug : `T${code}`;

  const slug = await uniquePublicSlug(admin, rawSlug);
  if (!slug) {
    return NextResponse.json({ error: "無法產生唯一的 public_slug" }, { status: 400 });
  }

  const feature =
    typeof b.feature_warehouse_ledger === "boolean"
      ? b.feature_warehouse_ledger
      : true;

  const ins = await admin.from("s").insert({
    _code: code,
    _slug: slug,
    company_name: companyName,
    status: "active",
    feature_warehouse_ledger: feature,
  });
  if (ins.error) {
    return NextResponse.json({ error: ins.error.message }, { status: 500 });
  }

  return NextResponse.json({
    numeric_code: code,
    public_slug: slug,
    company_name: companyName,
    feature_warehouse_ledger: feature,
    status: "active",
  });
}
