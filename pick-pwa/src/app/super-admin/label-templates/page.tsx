"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { withTenantParam } from "@/lib/tenantNav";

type PlatRow = {
  id: string;
  name: string;
  fields: unknown;
  updated_at: string;
};

export default function SuperAdminLabelTemplatesPage() {
  const router = useRouter();
  const [ok, setOk] = useState(false);
  const [rows, setRows] = useState<PlatRow[]>([]);
  const [name, setName] = useState("公版 A");
  const [fieldsJson, setFieldsJson] = useState("[]");
  const [msg, setMsg] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const auth = await fetch("/api/super-admin/session");
    const j = (await auth.json()) as { authenticated?: boolean };
    if (!j.authenticated) {
      router.replace(withTenantParam("/super-admin/login"));
      return false;
    }
    const res = await fetch("/api/super-admin/platform-label-templates");
    const p = (await res.json()) as { templates?: PlatRow[]; error?: string };
    if (!res.ok) {
      setMsg(p.error || "讀取失敗");
    } else {
      setRows(p.templates ?? []);
      setMsg(null);
    }
    return true;
  }, [router]);

  useEffect(() => {
    void (async () => {
      const loaded = await reload();
      setOk(Boolean(loaded));
    })();
  }, [reload]);

  const submit = async () => {
    setMsg(null);
    let fields: unknown;
    try {
      fields = JSON.parse(fieldsJson || "[]");
    } catch {
      setMsg("fields 須為有效 JSON（陣列）");
      return;
    }
    if (!Array.isArray(fields)) {
      setMsg("fields 須為陣列 JSON");
      return;
    }

    const res = await fetch("/api/super-admin/platform-label-templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), fields }),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      setMsg(j.error || "儲存失敗");
      return;
    }
    await reload();
  };

  if (!ok) return <main className="p-8 text-slate-500">載入…</main>;

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-black text-white">標籤格式公版</h1>
        <Link
          href={withTenantParam("/super-admin")}
          className="text-xs font-black text-amber-300 underline"
        >
          ← 總控
        </Link>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        全域 Excel 比對欄序列（JSON）；未來可讓「租戶後台／單位設定」複製並覆寫。
      </p>

      {msg ? (
        <p className="mt-4 rounded-lg bg-red-950/70 p-2 text-sm text-red-100">
          {msg}
        </p>
      ) : null}

      <section className="mt-6 space-y-2 rounded-xl border border-slate-800 bg-slate-900 p-4">
        <label className="block text-xs font-black text-slate-300">
          範本名稱
          <input
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-bold text-white"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="block text-xs font-black text-slate-300">
          fields（JSON 陣列）
          <textarea
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-sky-100"
            rows={8}
            value={fieldsJson}
            onChange={(e) => setFieldsJson(e.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={() => void submit()}
          className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-black text-slate-950"
        >
          新增公版
        </button>
      </section>

      <ul className="mt-8 space-y-2">
        {rows.map((r) => (
          <li
            key={r.id}
            className="rounded-lg border border-slate-800 bg-slate-900/70 px-3 py-2 text-xs"
          >
            <span className="font-black text-amber-200">{r.name}</span>
            <span className="ml-2 text-slate-500">
              · {new Date(r.updated_at).toLocaleString()}
            </span>
            <pre className="mt-2 max-h-28 overflow-auto text-[10px] text-slate-400">
              {JSON.stringify(r.fields, null, 2)}
            </pre>
          </li>
        ))}
      </ul>
    </main>
  );
}
