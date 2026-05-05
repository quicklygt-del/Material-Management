import { getSessionUser } from "@/lib/auth";
import { getDefaultLabelPrefix, normalizeLabelPrefix } from "@/lib/labelEncoding";

/**
 * 登入後 Session 的租戶 slug（與 label_records.tenant_id、company_id 一致）；
 * 未登入或未寫入時回落為建置環境的 NEXT_PUBLIC_LABEL_PREFIX。
 */
export function getEffectiveTenantSlug(): string {
  if (typeof window === "undefined") {
    return getDefaultLabelPrefix();
  }
  const u = getSessionUser();
  const raw = u?.tenant_slug?.trim();
  if (raw) return normalizeLabelPrefix(raw);
  return getDefaultLabelPrefix();
}
