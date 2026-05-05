import { NextResponse } from "next/server";
import {
  getDefaultLabelPrefix,
  normalizeLabelPrefix,
} from "@/lib/labelEncoding";
import {
  normalizeLabelTemplateFields,
} from "@/lib/labelPrintTemplate";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) {
    return missingServiceRoleResponse();
  }
  const url = new URL(req.url);
  const tenant_id =
    normalizeLabelPrefix(url.searchParams.get("tenant") ?? "") ||
    getDefaultLabelPrefix();

  const { data, error } = await admin
    .from("label_print_templates")
    .select("id,tenant_id,name,field_definitions,created_at,updated_at")
    .eq("tenant_id", tenant_id)
    .order("name", { ascending: true });

  if (error) {
    if (/column|does not exist|42703/i.test(error.message)) {
      return NextResponse.json(
        {
          error:
            "資料表 label_print_templates 尚未建立，請於 Supabase 執行 schema_label_print_templates.sql",
        },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ templates: data ?? [] });
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
    return NextResponse.json({ error: "請輸入範本名稱" }, { status: 400 });
  }
  const norm = normalizeLabelTemplateFields(b.field_definitions);
  if (!norm) {
    return NextResponse.json(
      {
        error:
          "欄位定義無效：須為 1～12 欄、每欄 key 須為系統支援值，且須恰好包含一個 print_count",
      },
      { status: 400 },
    );
  }

  const { data, error } = await admin
    .from("label_print_templates")
    .insert({
      tenant_id,
      name: name.slice(0, 120),
      field_definitions: norm,
      updated_at: new Date().toISOString(),
    })
    .select("id,tenant_id,name,field_definitions,created_at,updated_at")
    .single();

  if (error) {
    return NextResponse.json(
      {
        error: /column|does not exist|42703/i.test(error.message)
          ? "請先於 Supabase 執行 schema_label_print_templates.sql"
          : error.message,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ template: data });
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
  const id = String(b.id ?? "").trim();
  const tenant_id =
    normalizeLabelPrefix(String(b.tenant_id ?? "")) || getDefaultLabelPrefix();
  if (!id) {
    return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if ("name" in b) {
    const name = String(b.name ?? "").trim();
    if (!name) {
      return NextResponse.json({ error: "名稱不可為空" }, { status: 400 });
    }
    patch.name = name.slice(0, 120);
  }
  if ("field_definitions" in b) {
    const norm = normalizeLabelTemplateFields(b.field_definitions);
    if (!norm) {
      return NextResponse.json(
        {
          error:
            "欄位定義無效：須恰好包含一個 print_count，且 key 須為系統支援值",
        },
        { status: 400 },
      );
    }
    patch.field_definitions = norm;
  }

  if (Object.keys(patch).length <= 1) {
    return NextResponse.json({ error: "無更新內容" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("label_print_templates")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", tenant_id)
    .select("id,tenant_id,name,field_definitions,created_at,updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "找不到範本或租戶不符" }, { status: 404 });
  }

  return NextResponse.json({ template: data });
}

export async function DELETE(req: Request) {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) {
    return missingServiceRoleResponse();
  }
  const url = new URL(req.url);
  const id = url.searchParams.get("id")?.trim();
  const tenant_id =
    normalizeLabelPrefix(url.searchParams.get("tenant") ?? "") ||
    getDefaultLabelPrefix();
  if (!id) {
    return NextResponse.json({ error: "缺少 id" }, { status: 400 });
  }

  const { error } = await admin
    .from("label_print_templates")
    .delete()
    .eq("id", id)
    .eq("tenant_id", tenant_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
