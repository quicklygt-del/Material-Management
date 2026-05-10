import { NextResponse } from "next/server";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const NOT_FOUND = {
  found: false as const,
  item_name: "",
  spec: "",
};

/**
 * 以料號查 material_master（精確比對）。欄位以 item_no / item_name / spec 為準；
 * 若資料庫使用 material_code，會自動再試一次。
 */
export async function GET(req: Request) {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) {
    return missingServiceRoleResponse();
  }

  const itemNo = new URL(req.url).searchParams.get("item_no")?.trim() ?? "";
  if (!itemNo) {
    return NextResponse.json(NOT_FOUND);
  }

  const tryRow = async (
    col: "item_no" | "material_code",
  ): Promise<{ item_name: string; spec: string } | null> => {
    const { data, error } = await admin
      .from("material_master")
      .select("item_name,spec")
      .eq(col, itemNo)
      .maybeSingle();

    if (error) {
      if (/does not exist|42P01|relation/i.test(error.message)) {
        return null;
      }
      if (/column|42703/i.test(error.message)) {
        return null;
      }
      throw new Error(error.message);
    }
    if (!data) return null;
    const row = data as { item_name?: string | null; spec?: string | null };
    return {
      item_name: String(row.item_name ?? "").trim(),
      spec: String(row.spec ?? "").trim(),
    };
  };

  try {
    let got = await tryRow("item_no");
    if (!got) {
      got = await tryRow("material_code");
    }
    if (got) {
      return NextResponse.json({
        found: true as const,
        item_name: got.item_name,
        spec: got.spec,
      });
    }
    return NextResponse.json(NOT_FOUND);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "查詢失敗";
    if (/does not exist|42P01|relation/i.test(msg)) {
      return NextResponse.json(NOT_FOUND);
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
