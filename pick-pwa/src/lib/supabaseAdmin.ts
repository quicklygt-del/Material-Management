import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/**
 * 僅能於 Route Handler / Server Action 使用。
 * 具 service_role 時可繞過 RLS（請只在已驗證業務邏輯後呼叫）。
 */
/** 與 Vercel／各平台命名對齊：優先 SERVICE_ROLE，並支援少數別名 */
function getServiceRoleKey(): string {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_KEY ??
    process.env.SERVICE_ROLE_KEY ??
    ""
  ).trim();
}

export function getSupabaseServiceRoleClient(): SupabaseClient | null {
  const url = (
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    ""
  ).trim();
  const key = getServiceRoleKey();
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
      : !getServiceRoleKey()
        ? "缺少 SUPABASE_SERVICE_ROLE_KEY（或別名 SUPABASE_SERVICE_KEY）。請在本機 .env.local 或 Vercel Environment Variables 設定 Supabase service_role 密鑰。"
        : "";
  return NextResponse.json(
    {
      error: "Database Connection Error",
      message_zh: `無法連線資料庫。${hint} 設定後請重新部署。`,
    },
    { status: 503 },
  );
}
