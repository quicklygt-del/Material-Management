"use client";

import { ChevronDown } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { exitToLoginHome, getSessionUser } from "@/lib/auth";
import { LabelTemplateManagerSection } from "@/components/admin/LabelTemplateManagerSection";
import { AppBrandHeader } from "@/components/AppBrandHeader";
import {
  getDefaultLabelPrefix,
  normalizeLabelPrefix,
} from "@/lib/labelEncoding";
import { APP_VERSION } from "@/lib/version";
import { withTenantParam } from "@/lib/tenantNav";

type ZoneRow = {
  id: string;
  name: string;
  slug: string;
  portal_login: string;
  label_template_id?: string | null;
  created_at?: string;
  invite_expires_at?: string | null;
};

export default function OtherOperationsAdminPage() {
  const router = useRouter();
  const session = useMemo(() => getSessionUser(), []);

  /** 與 app_users.company_id／首頁 tenant 一致（system_admin 登入後寫入 tenant_slug） */
  const companyId = useMemo(() => {
    const slug = session?.tenant_slug?.trim();
    return slug ? normalizeLabelPrefix(slug) : getDefaultLabelPrefix();
  }, [session?.tenant_slug]);

  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newLogin, setNewLogin] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [newLabelTemplateId, setNewLabelTemplateId] = useState("");

  const [templateOptions, setTemplateOptions] = useState<
    { id: string; name: string }[]
  >([]);

  const [inviteById, setInviteById] = useState<Record<string, string>>({});

  useEffect(() => {
    if (session?.role !== "system_admin") {
      router.replace(withTenantParam("/"));
    }
  }, [router, session?.role]);

  const load = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      const u = new URL("/api/warehouses", window.location.origin);
      u.searchParams.set("tenant", companyId);
      const res = await fetch(u.toString());
      const j = (await res.json()) as {
        storage_zones?: ZoneRow[];
        error?: string;
      };
      if (!res.ok) throw new Error(j.error ?? "讀取失敗");
      setZones(j.storage_zones ?? []);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "讀取失敗");
      setZones([]);
    } finally {
      setBusy(false);
    }
  }, [companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const addZone = async () => {
    if (!newName.trim()) {
      setMsg("請輸入單位名稱");
      return;
    }
    if (!newLogin.trim()) {
      setMsg("請輸入登入帳號");
      return;
    }
    if (!newPwd.trim()) {
      setMsg("請輸入登入密碼（可為簡短密碼）");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/warehouses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          : companyId,
          name: newName.trim(),
          slug: newSlug.trim() || undefined,
          portal_login: newLogin.trim(),
          portal_password: newPwd,
          ...(newLabelTemplateId.trim()
            ? { label_template_id: newLabelTemplateId.trim() }
            : {}),
        }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? "新增失敗");
      setNewName("");
      setNewSlug("");
      setNewLogin("");
      setNewPwd("");
      setNewLabelTemplateId("");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "新增失敗");
    } finally {
      setBusy(false);
    }
  };

  const saveZonePatch = async (id: string, patch: Record<string, unknown>) => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/warehouses", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, : companyId, ...patch }),
      });
      const j = (await res.json()) as { error?: string; invite_token?: string };
      if (!res.ok) throw new Error(j.error ?? "更新失敗");
      if (j.invite_token) {
        const origin =
          typeof window !== "undefined" ? window.location.origin : "";
        setInviteById((prev) => ({
          ...prev,
          [id]: `${origin}/login/unit-invite?t=${encodeURIComponent(j.invite_token!)}`,
        }));
      }
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "更新失敗");
    } finally {
      setBusy(false);
    }
  };

  const purgeLedger = async (unitId: string) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm("確定清空此單位全部異動明細？不可逆。")
    ) {
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/universal-ledger/purge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ : companyId, unit_id: unitId }),
      });
      const j = (await res.json()) as {
        error?: string;
        deleted?: number;
      };
      if (!res.ok) throw new Error(j.error ?? "清空失敗");
      setMsg(`已清空（${typeof j.deleted === "number" ? j.deleted : "—"}）`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "清空失敗");
    } finally {
      setBusy(false);
    }
  };

  const removeZone = async (id: string, name: string) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(`刪除作業單位「${name}」及其帳本？`)
    )
      return;
    setBusy(true);
    try {
      const u = new URL("/api/warehouses", window.location.origin);
      u.searchParams.set("id", id);
      u.searchParams.set("tenant", companyId);
      const res = await fetch(u.toString(), { method: "DELETE" });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? "刪除失敗");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "刪除失敗");
    } finally {
      setBusy(false);
    }
  };

  if (session?.role !== "system_admin") {
    return null;
  }

  return (
    <main className="mx-auto min-h-screen max-w-4xl bg-slate-50 px-4 py-8">
      <AppBrandHeader section="單位設定" align="left" />
      <p className="mt-2 text-[11px] font-black text-blue-700">{APP_VERSION}</p>
      <nav className="mt-6 flex flex-wrap gap-4 text-sm font-bold text-purple-900">
        <button
          type="button"
          onClick={() => exitToLoginHome(router)}
          className="font-black text-red-800 underline"
        >
          登出管理員
        </button>
      </nav>
      <LabelTemplateManagerSection
        companyId={companyId}
        busy={busy}
        setBusy={setBusy}
        setMsg={setMsg}
        onListChange={setTemplateOptions}
      />

      <section className="mt-8 rounded-2xl border border-purple-100 bg-white p-5 shadow">
        <h2 className="text-lg font-black text-purple-950">新增作業單位</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <input
            className="rounded-lg border p-3 font-bold sm:col-span-2"
            placeholder="單位名稱（顯示於現場頁標題）"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoComplete="off"
          />
          <input
            className="rounded-lg border p-3 font-bold"
            placeholder="路徑 slug（可留白自動產生）"
            value={newSlug}
            onChange={(e) => setNewSlug(e.target.value)}
            autoComplete="off"
          />
          <input
            className="rounded-lg border p-3 font-bold"
            placeholder="登入帳號"
            value={newLogin}
            onChange={(e) => setNewLogin(e.target.value)}
            autoComplete="off"
          />
          <label className="sm:col-span-2">
            <span className="text-xs font-bold text-slate-600">
              指定標籤範本（現場 QR 標籤產製／Excel 解析）
            </span>
            <select
              className="mt-1 w-full rounded-lg border bg-white p-3 font-bold"
              value={newLabelTemplateId}
              onChange={(e) => setNewLabelTemplateId(e.target.value)}
              disabled={busy}
            >
              <option value="">
                無（預設四欄：料號／品名／規格／列印張數）
              </option>
              {templateOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <input
            type="password"
            name={`unit_${companyId.slice(0, 4)}_portal_pwd`}
            className="rounded-lg border p-3 font-bold sm:col-span-2"
            placeholder="登入密碼（不限強度／長度，由貴單位自定）"
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
            autoComplete="new-password"
            spellCheck={false}
          />
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void addZone()}
          className="mt-4 w-full rounded-xl bg-purple-700 py-3 font-black text-white disabled:opacity-40 sm:w-auto sm:px-8"
        >
          建立單位
        </button>
      </section>

      {msg ? (
        <p className="mx-auto mt-4 max-w-4xl rounded-xl bg-amber-50 p-4 text-center text-sm font-bold text-amber-950">
          {msg}
        </p>
      ) : null}

      <section className="mt-8 space-y-6">
        <h2 className="text-lg font-black text-slate-900">單位清單</h2>
        {busy && zones.length === 0 ? (
          <p className="font-bold text-slate-600">載入中…</p>
        ) : null}
        {zones.map((z) => (
          <UnitAdminCard
            key={z.id}
            zone={z}
            companyId={companyId}
            templateOptions={templateOptions}
            inviteUrl={inviteById[z.id]}
            busy={busy}
            onSave={(patch) => void saveZonePatch(z.id, patch)}
            onPurge={() => void purgeLedger(z.id)}
            onDelete={() => void removeZone(z.id, z.name)}
          />
        ))}
      </section>
    </main>
  );
}

function UnitAdminCard({
  zone,
  companyId,
  templateOptions,
  inviteUrl,
  busy,
  onSave,
  onPurge,
  onDelete,
}: {
  zone: ZoneRow;
  companyId: string;
  templateOptions: { id: string; name: string }[];
  inviteUrl?: string;
  busy: boolean;
  onSave: (p: Record<string, unknown>) => void;
  onPurge: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(zone.name);
  const [slug, setSlug] = useState(zone.slug);
  const [login, setLogin] = useState(zone.portal_login);
  const [labelTemplateId, setLabelTemplateId] = useState(
    () => (zone.label_template_id ? String(zone.label_template_id) : ""),
  );
  const [pwd, setPwd] = useState("");
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setName(zone.name);
    setSlug(zone.slug);
    setLogin(zone.portal_login);
    setLabelTemplateId(zone.label_template_id ? String(zone.label_template_id) : "");
    setPwd("");
  }, [zone]);

  const opUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/unit/${encodeURIComponent(zone.slug)}`
      : "";

  const title = (name.trim() || zone.name || "（未命名）").trim();

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition-colors hover:bg-slate-50 sm:px-5"
      >
        <span className="min-w-0 flex-1 text-lg font-black leading-tight text-slate-900">
          {title}
        </span>
        <ChevronDown
          className={`h-6 w-6 shrink-0 text-slate-500 transition-transform duration-200 ${
            expanded ? "rotate-180" : ""
          }`}
          aria-hidden
          strokeWidth={2.5}
        />
      </button>

      {expanded ? (
        <div className="border-t border-slate-100 px-4 pb-5 pt-1 sm:px-5">
      <p className="text-xs font-bold text-slate-500">#{zone.id.slice(0, 8)}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="text-xs font-bold text-slate-600">名稱</span>
          <input
            className="mt-1 w-full rounded-lg border p-3 font-black"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          <span className="text-xs font-bold text-slate-600">Slug（URL）</span>
          <input
            className="mt-1 w-full rounded-lg border p-3 font-bold"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          />
        </label>
        <label>
          <span className="text-xs font-bold text-slate-600">登入帳號</span>
          <input
            className="mt-1 w-full rounded-lg border p-3 font-bold"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
          />
        </label>
        <label className="sm:col-span-2">
          <span className="text-xs font-bold text-slate-600">
            指定標籤範本（現場 QR／Excel）
          </span>
          <select
            className="mt-1 w-full rounded-lg border bg-white p-3 font-bold"
            value={labelTemplateId}
            onChange={(e) => setLabelTemplateId(e.target.value)}
            disabled={busy}
          >
            <option value="">無（預設四欄）</option>
            {templateOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label className="sm:col-span-2">
          <span className="text-xs font-bold text-slate-600">
            重置密碼（空白則不變）
          </span>
          <input
            type="password"
            name={`unit_edit_${zone.id.slice(0, 8)}_pwd`}
            className="mt-1 w-full rounded-lg border p-3 font-bold"
            value={pwd}
            onChange={(e) => setPwd(e.target.value)}
            placeholder="若需重置請輸入新密碼（不限強度）"
            autoComplete="new-password"
            spellCheck={false}
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            onSave({
              name: name.trim(),
              slug: slug.trim(),
              portal_login: login.trim(),
              label_template_id: labelTemplateId.trim() || null,
              ...(pwd.trim()
                ? { portal_password: pwd }
                : {}),
            })
          }
          className="rounded-xl bg-purple-700 px-4 py-2 text-sm font-black text-white disabled:opacity-40"
        >
          儲存
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onSave({ regenerate_invite: true })}
          className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-black text-white disabled:opacity-40"
        >
          產製進場 QR
        </button>
        <a
          className="inline-flex rounded-xl bg-sky-700 px-4 py-2 text-sm font-black text-white"
          href={`/api/universal-ledger/export?tenant=${companyId}&unit_id=${zone.id}&format=xlsx`}
        >
          下載總帳 Excel
        </a>
        <button
          type="button"
          disabled={busy}
          onClick={onPurge}
          className="rounded-xl border border-red-600 px-4 py-2 text-sm font-black text-red-800 disabled:opacity-40"
        >
          清空明細
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onDelete}
          className="rounded-xl bg-red-700 px-4 py-2 text-sm font-black text-white disabled:opacity-40"
          title="將刪除此單位與其所屬標籤帳本紀錄"
        >
          刪除單位
        </button>
      </div>

      <div className="mt-4 rounded-xl bg-slate-50 p-3 text-[11px] font-bold leading-relaxed text-slate-900">
        <div>前台路徑：{opUrl || "／unit/…"}</div>
      </div>

      {inviteUrl ? (
        <div className="mt-4 flex flex-col items-center rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <p className="mb-3 text-xs font-black text-emerald-900">
            一掃即入 · 請列印或由手機出示
          </p>
          <QRCodeSVG value={inviteUrl} size={148} level="M" />
          <p className="mt-2 max-w-[20rem] break-all text-[10px] text-emerald-900">
            {inviteUrl}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-xs text-slate-600">
          按「產製進場 QR」以上方網址產製授權連結 QR。
          {zone.invite_expires_at
            ? `（目前令牌到期：${new Date(zone.invite_expires_at).toLocaleString("zh-TW")}）`
            : null}
        </p>
      )}
        </div>
      ) : null}
    </div>
  );
}
