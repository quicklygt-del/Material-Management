/**
 * 由掃描或貼上的原始字串產生多組候選，供 label_records 比對（qr_payload、id、item_no）。
 */
export function buildQrLookupCandidates(input: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const push = (s: string) => {
    const t = s.replace(/\uFEFF/g, "").trim();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  };

  const s0 = String(input ?? "").replace(/\uFEFF/g, "").trim();
  if (!s0) return [];

  push(s0);
  try {
    const dec = decodeURIComponent(s0);
    if (dec !== s0) push(dec);
  } catch {
    void 0;
  }

  const uuidRe =
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;
  const m = s0.match(uuidRe);
  if (m) for (const u of m) push(u);

  if (/^https?:\/\//i.test(s0)) {
    try {
      const u = new URL(s0);
      for (const key of ["qr", "id", "label", "label_id", "record", "p"]) {
        const v = u.searchParams.get(key)?.trim();
        if (v) push(v);
      }
      const path = u.pathname.replace(/\/$/, "");
      const parts = path.split("/").filter(Boolean);
      const last = parts[parts.length - 1];
      if (last) push(last);
    } catch {
      void 0;
    }
  }

  const unquoted = s0.replace(/^["'「]|[""'」]$/g, "").trim();
  if (unquoted !== s0) push(unquoted);

  return out;
}
