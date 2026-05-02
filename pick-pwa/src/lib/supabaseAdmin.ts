import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/**
 * 僅能於 Route Handler / Server Action 使用。
 * 具 service_role 時可繞過 RLS（請只在已驗證業務邏輯後呼叫）。
 */
export function getSupabaseServiceRoleClient(): SupabaseClient | null {
  const url = (
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    ""
  ).trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Vercel／本機需在環境變數設定 Supabase URL 與 service_role 金鑰 */
export function missingServiceRoleResponse(): NextResponse {
  const hint =
    !process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
    !process.env.SUPABASE_URL?.trim()
      ? "缺少 NEXT_PUBLIC_SUPABASE_URL（或 SUPABASE_URL）。"
      : !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
        ? "缺少 SUPABASE_SERVICE_ROLE_KEY（請至 Supabase 專案 Settings → API 複製 service_role）。"
        : "";
  return NextResponse.json(
    {
      error: `無法連線資料庫。${hint} 設定後請重新部署。`,
    },
    { status: 503 },
  );
}
