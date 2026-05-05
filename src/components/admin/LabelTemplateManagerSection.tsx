"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getDefaultLabelTemplateFields,
  humanDescribeTemplateColumns,
  LABEL_TEMPLATE_KEY_PRESETS,
  normalizeLabelTemplateFields,
  type LabelTemplateField,
} from "@/lib/labelPrintTemplate";

export type LabelTemplateListItem = {
  id: string;
  name: string;
  field_definitions: LabelTemplateField[];
};

function moveField(arr: LabelTemplateField[], i: number, delta: number) {
  const j = i + delta;
  if (j < 0 || j >= arr.length) return arr;
  const next = [...arr];
  const t = next[i];
  next[i] = next[j];
  next[j] = t;
  return next;
}

function FieldOrderEditor({
  value,
  onChange,
  disabled,
}: {
  value: LabelTemplateField[];
  onChange: (v: LabelTemplateField[]) => void;
  disabled?: boolean;
}) {
  return (
    <ul className="mt-2 space-y-2 rounded-xl border border-purple-100 bg-purple-50/50 p-3">
      {value.map((f, i) => (
        <li
          key={`${i}-${f.key}`}
          className="flex flex-wrap items-center gap-2 text-sm"
        >
          <span className="w-8 font-black text-purple-900">{i + 1}</span>
          <select
            className="min-h-[40px] flex-1 rounded-lg border border-purple-200 bg-white px-2 font-bold"
            disabled={disabled}
            value={f.key}
            onChange={(e) => {
              const k = e.target.value;
              const preset = LABEL_TEMPLATE_KEY_PRESETS.find((p) => p.key === k);
              const next = [...value];
              next[i] = {
                key: k,
                ...(preset ? { label_zh: preset.label_zh } : {}),
              };
              onChange(next);
            }}
          >
            {LABEL_TEMPLATE_KEY_PRESETS.map((p) => {
              const dup =
                value.some((x, xi) => xi !== i && x.key === p.key) &&
                p.key !== "print_count";
              const printDup =
                p.key === "print_count" &&
                value.some((x, xi) => xi !== i && x.key === "print_count");
              const dis = dup || printDup;
              return (
                <option key={p.key} value={p.key} disabled={dis}>
                  {p.label_zh}（{p.key}）
                </option>
              );
            })}
          </select>
          <input
            className="min-h-[40px] w-28 rounded-lg border border-purple-200 bg-white px-2 text-xs font-bold"
            placeholder="顯示別名"
            disabled={disabled}
            value={f.label_zh ?? ""}
            onChange={(e) => {
              const next = [...value];
              next[i] = { ...next[i], label_zh: e.target.value.slice(0, 24) };
              onChange(next);
            }}
          />
          <button
            type="button"
            disabled={disabled || i === 0}
            onClick={() => onChange(moveField(value, i, -1))}
            className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-black disabled:opacity-30"
          >
            上移
          </button>
          <button
            type="button"
            disabled={disabled || i === value.length - 1}
            onClick={() => onChange(moveField(value, i, 1))}
            className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-black disabled:opacity-30"
          >
            下移
          </button>
          <button
            type="button"
            disabled={disabled || value.length <= 2}
            onClick={() =>
              onChange(value.filter((_, xi) => xi !== i))
            }
            className="rounded-lg bg-red-50 px-2 py-1 text-xs font-black text-red-800 disabled:opacity-30"
          >
            刪除此欄
          </button>
        </li>
      ))}
    </ul>
  );
}

function validateFieldsForSave(fields: LabelTemplateField[]): string | null {
  const norm = normalizeLabelTemplateFields(fields);
  if (!norm) {
    return "欄位無效：須 1～12 欄、鍵值須為系統清單之一，且恰好一個「列印張數(print_count)」。同一語意鍵不可重複（除系統允許者外）。";
  }
  return null;
}

export function LabelTemplateManagerSection({
  companyId,
  busy,
  setBusy,
  setMsg,
  onListChange,
}: {
  companyId: string;
  busy: boolean;
  setBusy: (v: boolean) => void;
  setMsg: (s: string | null) => void;
  onListChange: (opts: { id: string; name: string }[]) => void;
}) {
  const [rows, setRows] = useState<LabelTemplateListItem[]>([]);
  const [createName, setCreateName] = useState("");
  const [createFields, setCreateFields] = useState<LabelTemplateField[]>(() =>
    getDefaultLabelTemplateFields(),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editFields, setEditFields] = useState<LabelTemplateField[]>([]);

  const refresh = useCallback(async () => {
    try {
      const u = new URL("/api/label-print-templates", window.location.origin);
      u.searchParams.set("tenant", companyId);
      const res = await fetch(u.toString());
      const j = (await res.json()) as {
        templates?: LabelTemplateListItem[];
        error?: string;
      };
      if (!res.ok) throw new Error(j.error ?? "讀取範本失敗");
      const list = j.templates ?? [];
      setRows(list);
      onListChange(list.map((x) => ({ id: x.id, name: x.name })));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "讀取範本失敗");
      setRows([]);
      onListChange([]);
    }
  }, [companyId, onListChange, setMsg]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addPresetField = (fields: LabelTemplateField[], setter: (v: LabelTemplateField[]) => void) => {
    const used = new Set(fields.map((x) => x.key));
    const nextKey =
      LABEL_TEMPLATE_KEY_PRESETS.map((p) => p.key).find(
        (k) => !used.has(k),
      ) ?? "remark";
    const preset = LABEL_TEMPLATE_KEY_PRESETS.find((p) => p.key === nextKey);
    setter([
      ...fields,
      {
        key: nextKey,
        ...(preset ? { label_zh: preset.label_zh } : {}),
      },
    ]);
  };

  const createTemplate = async () => {
    const err = validateFieldsForSave(createFields);
    if (err) {
      setMsg(err);
      return;
    }
    const name = createName.trim();
    if (!name) {
      setMsg("請輸入範本名稱");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const norm = normalizeLabelTemplateFields(createFields)!;
      const res = await fetch("/api/label-print-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: companyId,
          name,
          field_definitions: norm,
        }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? "建立失敗");
      setCreateName("");
      setCreateFields(getDefaultLabelTemplateFields());
      await refresh();
      setMsg("範本已建立");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "建立失敗");
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (id: string) => {
    const err = validateFieldsForSave(editFields);
    if (err) {
      setMsg(err);
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const norm = normalizeLabelTemplateFields(editFields)!;
      const res = await fetch("/api/label-print-templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          tenant_id: companyId,
          name: editName.trim(),
          field_definitions: norm,
        }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? "儲存失敗");
      setEditingId(null);
      await refresh();
      setMsg("範本已更新");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setBusy(false);
    }
  };

  const removeTemplate = async (id: string, name: string) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`確定刪除範本「${name}」？已綁定單位將改為無範本（預設欄）。`)
    )
      return;
    setBusy(true);
    setMsg(null);
    try {
      const u = new URL("/api/label-print-templates", window.location.origin);
      u.searchParams.set("tenant", companyId);
      u.searchParams.set("id", id);
      const res = await fetch(u.toString(), { method: "DELETE" });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? "刪除失敗");
      if (editingId === id) setEditingId(null);
      await refresh();
      setMsg("範本已刪除");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "刪除失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-8 rounded-2xl border border-violet-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-black text-violet-950">標籤範本管理</h2>
      <p className="mt-2 text-xs font-semibold text-slate-600">
        設定範本名稱與<strong>欄位順序</strong>（第 1 欄對應 Excel A 欄，以此類推）。須保留一欄為「列印張數」，QR
        內容由其餘欄依序換行組成。於下方「新增作業單位」表單可指定範本；現場「QR
        標籤產製」將依綁定範本解析 Excel 並顯示預覽說明。
      </p>

      <div className="mt-5 rounded-xl border border-dashed border-violet-200 bg-violet-50/40 p-4">
        <h3 className="text-sm font-black text-violet-900">新增範本</h3>
        <input
          className="mt-2 w-full rounded-lg border p-3 font-bold"
          placeholder="範本名稱（例如：收發標籤、品保標籤）"
          value={createName}
          onChange={(e) => setCreateName(e.target.value)}
          disabled={busy}
          autoComplete="off"
        />
        <FieldOrderEditor
          value={createFields}
          onChange={setCreateFields}
          disabled={busy}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || createFields.length >= 12}
            onClick={() => addPresetField(createFields, setCreateFields)}
            className="rounded-lg border border-violet-400 px-3 py-2 text-sm font-black text-violet-900 disabled:opacity-40"
          >
            新增一欄
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void createTemplate()}
            className="rounded-xl bg-violet-700 px-5 py-2.5 text-sm font-black text-white disabled:opacity-40"
          >
            建立範本
          </button>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        <h3 className="text-sm font-black text-slate-800">既有範本</h3>
        {rows.length === 0 ? (
          <p className="text-sm font-bold text-slate-500">
            尚無範本；若資料表未建立，請於 Supabase 執行{" "}
            <code className="rounded bg-slate-100 px-1 text-xs">
              schema_label_print_templates.sql
            </code>
          </p>
        ) : null}
        {rows.map((r) => (
          <div
            key={r.id}
            className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-base font-black text-slate-900">{r.name}</p>
                <p className="mt-1 text-[11px] font-bold text-slate-600">
                  {humanDescribeTemplateColumns(
                    normalizeLabelTemplateFields(r.field_definitions) ??
                      r.field_definitions,
                  )}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {editingId === r.id ? (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void saveEdit(r.id)}
                      className="rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-black text-white disabled:opacity-40"
                    >
                      儲存
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setEditingId(null)}
                      className="rounded-lg border px-3 py-1.5 text-xs font-black disabled:opacity-40"
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setEditingId(r.id);
                        setEditName(r.name);
                        setEditFields(
                          normalizeLabelTemplateFields(r.field_definitions) ??
                            r.field_definitions,
                        );
                      }}
                      className="rounded-lg border border-violet-400 px-3 py-1.5 text-xs font-black text-violet-900 disabled:opacity-40"
                    >
                      編輯
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void removeTemplate(r.id, r.name)}
                      className="rounded-lg bg-red-700 px-3 py-1.5 text-xs font-black text-white disabled:opacity-40"
                    >
                      刪除
                    </button>
                  </>
                )}
              </div>
            </div>
            {editingId === r.id ? (
              <div className="mt-3 border-t border-slate-200 pt-3">
                <label className="text-xs font-bold text-slate-600">範本名稱</label>
                <input
                  className="mt-1 w-full rounded-lg border bg-white p-2 font-bold"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  disabled={busy}
                />
                <FieldOrderEditor
                  value={editFields}
                  onChange={setEditFields}
                  disabled={busy}
                />
                <button
                  type="button"
                  disabled={busy || editFields.length >= 12}
                  onClick={() => addPresetField(editFields, setEditFields)}
                  className="mt-2 rounded-lg border border-violet-400 px-3 py-1.5 text-xs font-black text-violet-900 disabled:opacity-40"
                >
                  新增一欄
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
