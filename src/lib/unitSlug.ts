/** 產生 /unit/[slug] 用路徑：英數小寫與連字 */

export function slugifyUnitBase(name: string): string {
  const s = name
    .replace(/\uFEFF/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (!s) return "";
  const ascii = s.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "");
  return ascii.length >= 2 ? ascii : `zone-${sliceRandom()}`;
}

function sliceRandom(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
  }
  return String(Math.floor(Math.random() * 1e9));
}
