/**
 * picking_tasks / picking_logs 的  欄位僅在執行 patch_multi_tenant_saas.sql 後存在。
 *
 * - 未設定或為 false：查詢／寫入**不帶** （相容 schema_wms 舊庫）。
 * - 設為 true：與多租戶 patch 一致，**必須**有  欄位與對應唯一索引。
 *
 * 生產環境若已建  且需租戶隔離，請設：
 * NEXT_PUBLIC_PICKING_TASKS_USE_=true
 */
export function isPickingTasksTenantScoped(): boolean {
  return false;
}
