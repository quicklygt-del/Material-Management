import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * 取得環境變數的輔助函式
 * 優先讀取 NEXT_PUBLIC_ 前綴，確保瀏覽器端可存取
 */
function getSupabaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_URL ?? 
    ""
  ).trim();
}

function getSupabaseAnonKey(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    ""
  ).trim();
}

let browserClient: SupabaseClient | null = null;

/**
 * 瀏覽器端 Supabase 客戶端實例化邏輯
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  if (browserClient) return browserClient;
  
  const url = getSupabaseUrl();
  const key = getSupabaseAnonKey();
  
  if (!url || !key) {
    // 此錯誤通常發生在 Vercel 未設定 NEXT_PUBLIC_ 變數時
    console.error("❌ 缺少 Supabase 環境變數，請檢查 Vercel 設定");
    return createClient("https://placeholder.supabase.co", "placeholder"); 
  }
  
  browserClient = createClient(url, key);
  return browserClient;
}

/**
 * 【核心修正】具名匯出 supabase 實例
 * 解決您的 page.tsx 報錯：'supabase' is not exported
 */
export const supabase = getSupabaseBrowserClient();

/**
 * 【除錯工具】掛載至全域 window 物件
 * 解決您在 Console 測試時出現的 reading 'from' of undefined 錯誤
 */
if (typeof window !== "undefined") {
  (
    window as Window &
      typeof globalThis & { supabase?: SupabaseClient }
  ).supabase = supabase;
  // 佈署後可在 Console 看到此訊息，確認初始化成功
  if (getSupabaseUrl()) {
    console.log("✅ Supabase Client 已成功掛載至 window.supabase");
  }
}