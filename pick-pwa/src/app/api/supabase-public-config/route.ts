import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** 供同網域靜態頁取得瀏覽器端 Supabase 連線（anon key 本即公開）。 */
export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  if (!url || !anonKey) {
    return NextResponse.json(
      { error: "缺少 NEXT_PUBLIC_SUPABASE_URL 或 NEXT_PUBLIC_SUPABASE_ANON_KEY" },
      { status: 503 },
    );
  }
  return NextResponse.json({ url, anonKey });
}
