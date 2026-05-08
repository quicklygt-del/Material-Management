import { NextResponse } from "next/server";
import {
  getSupabaseServiceRoleClient,
  missingServiceRoleResponse,
} from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = getSupabaseServiceRoleClient();
  if (!admin) return missingServiceRoleResponse();

  let primary = await admin
    .from("inventory_transactions")
    .select(
      "id,created_at,operator_name,order_no,item_no,action_type,quantity_delta",
    )
    .order("created_at", { ascending: false })
    .limit(1000);

  if (primary.error) {
    const fallback = await admin
      .from("inventory_transactions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1000);
    if (fallback.error) {
      return NextResponse.json({ error: fallback.error.message }, { status: 500 });
    }
    return NextResponse.json({ rows: fallback.data ?? [] });
  }

  return NextResponse.json({ rows: primary.data ?? [] });
}
