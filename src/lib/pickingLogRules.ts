/** DB 若無 scan_result 欄位：以列內容判定 */

export function isPickingLogCountedAsPick(l: {
  actual_qty?: unknown;
}): boolean {
  return (Number(l.actual_qty) || 0) > 0;
}

export function isPickingLogMismatch(l: {
  actual_qty?: unknown;
  mismatch_reason?: unknown;
  variance_note?: unknown;
}): boolean {
  if (isPickingLogCountedAsPick(l)) return false;
  if (String(l.mismatch_reason ?? "").trim()) return true;
  return String(l.variance_note ?? "").startsWith("掃錯");
}
