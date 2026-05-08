/** 企業識別（tenant）— 與 DB label_records. 對齊；預設可由環境覆寫 */

const STORAGE_KEY = "label-center-tenant-id";

export function getDefaultTenantFromEnv(): string {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_) {
    return String(process.env.NEXT_PUBLIC_).trim();
  }
  return "DEMO";
}

export function getStoredTenantId(): string {
  if (typeof window === "undefined") return getDefaultTenantFromEnv();
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v?.trim()) return v.trim();
  } catch {
    void 0;
  }
  return getDefaultTenantFromEnv();
}

export function setStoredTenantId(tenantId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, tenantId.trim());
  } catch {
    void 0;
  }
}
