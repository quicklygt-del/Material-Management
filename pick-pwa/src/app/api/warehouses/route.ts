import { NextResponse } from "next/server";
import {
  getDefaultLabelPrefix,
  normalizeLabelPrefix,
} from "@/lib/labelEncoding";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const MAX_WAREHOUSES = 5;

export async function GET(req: Request) {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) {
    return missingServiceRoleResponse();
  }
  const url = new URL(req.url);
  const fromQuery = normalizeLabelPrefix(url.searchParams.get("tenant") ?? "");
  const tenant_id = fromQuery || getDefaultLabelPrefix();
  const { data, error } = await admin
    .from("storage_zones")
    .select("id,tenant_id,name,created_at")
    .eq("tenant_id", tenant_id)
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const zones = data ?? [];
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
  const tenant_id =
    normalizeLabelPrefix(String(b.tenant_id ?? "")) || getDefaultLabelPrefix();
  const name = String(b.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "缺少倉庫名稱" }, { status: 400 });
  }
  const { count, error: cErr } = await admin
    .from("storage_zones")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenant_id);
  if (cErr) {
    return NextResponse.json({ error: cErr.message }, { status: 500 });
  }
  if ((count ?? 0) >= MAX_WAREHOUSES) {
    return NextResponse.json(
      { error: `每公司最多 ${MAX_WAREHOUSES} 個虛擬倉` },
      { status: 400 },
    );
  }
  const { data, error } = await admin
    .from("storage_zones")
    .insert({ tenant_id, name })
    .select("id,tenant_id,name,created_at")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ warehouse: data });
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
  const name = String(b.name ?? "").trim();
  if (!id || !name) {
    return NextResponse.json({ error: "缺少 id 或名稱" }, { status: 400 });
  }
  const { data, error } = await admin
    .from("storage_zones")
    .update({ name })
    .eq("id", id)
    .select("id,tenant_id,name,created_at")
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ warehouse: data });
}

export async function DELETE(req: Request) {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) {
    return missingServiceRoleResponse();
  }
  const url = new URL(req.url);
  const id = url.searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  }
  const { error } = await admin.from("storage_zones").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
