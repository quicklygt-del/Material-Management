import { NextResponse } from "next/server";

import { isSuperAdminRequest } from "@/lib/superAdminRequest";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await isSuperAdminRequest())) {
    return NextResponse.json({ error: "未授權" }, { status: 401 });
  }
  const admin = getSupabaseServiceRoleClient();
  if (!admin) return missingServiceRoleResponse();

  const { data, error } = await admin
    .from("platform_label_sheet_templates")
    .select("id,name,fields,updated_at")
    .order("updated_at", { ascending: false });

  if (error) {
    if (/does not exist|relation.*platform_label/i.test(error.message)) {
      return NextResponse.json({ templates: [] });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ templates: data ?? [] });
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
  const name = String(b.name ?? "").trim();
  const fields = b.fields != null ? b.fields : [];

  if (!name) {
    return NextResponse.json({ error: "請填 name" }, { status: 400 });
  }
  if (!Array.isArray(fields)) {
    return NextResponse.json({ error: "fields 須為陣列 JSON" }, { status: 400 });
  }

  const { error } = await admin.from("platform_label_sheet_templates").insert({
    name,
    fields,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
