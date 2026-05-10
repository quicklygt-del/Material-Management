/** 單機：storage_zones 查詢不再帶範圍欄位隔離。 */

export function storageZonesSelectFull(): string {
  return "id,name,created_at,slug,portal_login,invite_expires_at,label_template_id";
}

export function storageZonesSelectNoLabelTemplate(): string {
  return "id,name,created_at,slug,portal_login,invite_expires_at";
}

export function storageZonesSelectIdScope(): string {
  return "id";
}

export function storageZonesSelectPatch(): string {
  return "id,name,slug,portal_login,label_template_id";
}

export function storageZonesSelectNameScope(): string {
  return "id,name";
}
