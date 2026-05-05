/**
 * 全站品牌列：大標 + 可選區塊標題（副標僅首頁使用，此處不帶）
 */
export function AppBrandHeader({
  section,
  className = "",
  align = "center",
}: {
  section?: string;
  className?: string;
  align?: "center" | "left";
}) {
  const ta = align === "left" ? "text-left" : "text-center";
  return (
    <div className={`${ta} ${className}`}>
      <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-500 sm:text-sm">
        AI 智能 QR 管理系統
      </p>
      {section ? (
        <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
          {section}
        </h1>
      ) : null}
    </div>
  );
}

export const APP_BRAND_TITLE = "AI 智能 QR 管理系統";
export const APP_BRAND_TAGLINE = "讓管理因 AI 而更簡單";
