/** 入庫掃描：由原始字串解析料號（與現場 operate 邏輯對齊，無瀏覽器依賴）。 */

export function normItemNo(s: string): string {
  return s.replace(/\uFEFF/g, "").trim();
}

export function parseScanAsItemNo(raw: string): string | null {
  const trimmed = String(raw ?? "").replace(/\uFEFF/g, "").trim();
  if (!trimmed) return null;

  const fromQueryKey = (str: string): string | null => {
    const m =
      /(?:^|[?&#])(?:item_no|item_no|item|sku|code)=([^&#]+)/i.exec(str);
    if (!m?.[1]) return null;
    try {
      const v = decodeURIComponent(m[1].replace(/\+/g, " "));
      const n = normItemNo(v);
      return n.length ? n : null;
    } catch {
      return normItemNo(m[1]) || null;
    }
  };

  const q = fromQueryKey(trimmed);
  if (q) return q;

  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
      const u = new URL(trimmed);
      const qp =
        u.searchParams.get("item_no") ||
        u.searchParams.get("item_no") ||
        u.searchParams.get("item") ||
        u.searchParams.get("sku") ||
        u.searchParams.get("code");
      if (qp?.trim()) {
        const n = normItemNo(qp);
        if (n) return n;
      }
      const path = u.pathname.replace(/\/+$/, "");
      const seg = path.split("/").filter(Boolean).pop();
      if (seg) {
        const n = normItemNo(decodeURIComponent(seg));
        if (n && !/^index\.(html?|php)$/i.test(n)) return n;
      }
    }
  } catch {
    void 0;
  }

  const direct = normItemNo(trimmed);
  return direct.length ? direct : null;
}

export function collectItemCodeCandidates(raw: string): string[] {
  const seen = new Set<string>();
  const list: string[] = [];
  const add = (s: string) => {
    const n = normItemNo(s);
    if (!n) return;
    const key = n.toUpperCase();
    if (seen.has(key)) return;
    seen.add(key);
    list.push(n);
  };

  const primary = parseScanAsItemNo(raw);
  if (primary) add(primary);
  add(raw);
  for (const part of raw.split(/[\s|;,\t\/]+/)) add(part);

  const codeLike =
    /\b[A-Za-z]{2,}[\w.-]*-[A-Za-z0-9][\w.-]*\b|\b[A-Za-z]\d{2,}[A-Za-z0-9.-]*\b/g;
  let m: RegExpExecArray | null;
  while ((m = codeLike.exec(raw))) add(m[0]);

  return list;
}

export function itemNoMatchesTask(taskItem: string, scanned: string): boolean {
  const a = normItemNo(taskItem);
  const b = normItemNo(scanned);
  if (!a || !b) return false;
  return a === b || a.toUpperCase() === b.toUpperCase();
}
