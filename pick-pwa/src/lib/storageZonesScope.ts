/**
 * storage_zones 的租戶範圍欄位：舊庫為 tenant_id，若已遷移為 company_id，
 * 請在環境變數設定：NEXT_PUBLIC_STORAGE_ZONES_SCOPE_COLUMN=company_id
 * （僅影響 storage_zones；label_records 等表仍可能使用 tenant_id 欄名）
 */
export type StorageZonesScopeColumn = "tenant_id" | "company_id";

export function getStorageZonesScopeColumn(): StorageZonesScopeColumn {
  const raw = (
    process.env.NEXT_PUBLIC_STORAGE_ZONES_SCOPE_COLUMN ?? "tenant_id"
  )
    .trim()
    .toLowerCase();
  return raw === "company_id" ? "company_id" : "tenant_id";
}

/** 從列讀取租戶／公司識別碼（與 label QR 前綴一致） */
export function zoneRowScopeValue(
  row: { tenant_id?: unknown; company_id?: unknown },
): string {
  const col = getStorageZonesScopeColumn();
  if (col === "company_id") {
    return String(row.company_id ?? row.tenant_id ?? "").trim();
  }
  return String(row.tenant_id ?? row.company_id ?? "").trim();
}

export function storageZonesSelectFull(): string {
  const c = getStorageZonesScopeColumn();
  return `id,${c},name,created_at,slug,portal_login,invite_expires_at,label_template_id`;
}

export function storageZonesSelectNoLabelTemplate(): string {
  const c = getStorageZonesScopeColumn();
  return `id,${c},name,created_at,slug,portal_login,invite_expires_at`;
}

export function storageZonesSelectIdScope(): string {
  const c = getStorageZonesScopeColumn();
  return `id,${c}`;
}

export function storageZonesSelectPatch(): string {
  const c = getStorageZonesScopeColumn();
  return `id,${c},name,slug,portal_login,label_template_id`;
}

/** 驗證單位是否隸屬某租戶時常用：含顯示名稱 */
export function storageZonesSelectNameScope(): string {
  const c = getStorageZonesScopeColumn();
  return `id,name,${c}`;
}
