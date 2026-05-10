import { NextResponse } from "next/server";

import { isSuperAdminRequest } from "@/lib/superAdminRequest";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: { numeric_code: string } },
) {
  if (!(await isSuperAdminRequest())) {
    return NextResponse.json({ error: "未授權" }, { status: 401 });
  }
  const admin = getSupabaseServiceRoleClient();
  if (!admin) return missingServiceRoleResponse();

  const codeRaw = params.numeric_code;
  const numeric_code = String(codeRaw ?? "").trim().padStart(3, "0");
  if (!/^\d{3}$/.test(numeric_code)) {
    return NextResponse.json({ error: "無效的 numeric_code" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON 格式錯誤" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (typeof b.status === "string") {
    const s = b.status.trim().toLowerCase();
    if (s !== "active" && s !== "suspended") {
      return NextResponse.json({ error: "status 須為 active 或 suspended" }, { status: 400 });
    }
    patch.status = s === "active" ? "active" : "suspended";
  }

  if (typeof b.feature_warehouse_ledger === "boolean") {
    patch.feature_warehouse_ledger = b.feature_warehouse_ledger;
  }

  if (typeof b.company_name === "string") {
    const cn = b.company_name.trim();
    if (cn) patch.company_name = cn;
  }

  if (Object.keys(patch).length <= 1) {
    return NextResponse.json({ error: "請提供要更新的欄位" }, { status: 400 });
  }

  const { error } = await admin
    .from("s")
    .update(patch)
    .eq("_code", numeric_code);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
