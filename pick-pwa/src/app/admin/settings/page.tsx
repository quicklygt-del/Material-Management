"use client";

import { QRCodeSVG } from "qrcode.react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppBrandHeader } from "@/components/AppBrandHeader";
import { WarehouseSupervisorNav } from "@/components/nav/WarehouseSupervisorNav";
import { canAccessAdminSettingsPage, getSessionUser } from "@/lib/auth";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { getEffectiveTenantSlug } from "@/lib/tenantContext";
import { withTenantParam } from "@/lib/tenantNav";
import { APP_VERSION } from "@/lib/version";

type OperatorRow = {
  id: string;
  name: string;
  password: string;
  active: boolean;
};

export default function AdminSettingsPage() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [operators, setOperators] = useState<OperatorRow[]>([]);
  const [opModalOpen, setOpModalOpen] = useState(false);
  const [editingOp, setEditingOp] = useState<OperatorRow | null>(null);
  const [opFormName, setOpFormName] = useState("");
  const [opFormPassword, setOpFormPassword] = useState("");
  const [qrTarget, setQrTarget] = useState<OperatorRow | null>(null);

  const buildOperatorEntryUrl = useCallback((operatorName: string) => {
    const tenant = getEffectiveTenantSlug();
    const u = new URL("/", window.location.origin);
    u.searchParams.set("tenant", tenant);
    u.searchParams.set("prefill", operatorName.trim());
    return u.toString();
  }, []);

  useEffect(() => {
    const user = getSessionUser();
    if (user?.role === "system_admin") {
      router.replace(withTenantParam("/admin/other-operations"));
      return;
    }
    if (!user || !canAccessAdminSettingsPage(user.role)) {
      setMsg("僅倉儲主管可進入倉管員設定。");
      return;
    }
    setReady(true);
    setMsg(null);
  }, [router]);

  const loadOperators = useCallback(async () => {
    const tenant = getEffectiveTenantSlug();
    const { data, error } = await supabase
      .from("warehouse_operators")
      .select("id,name,password,active")
      .eq("company_id", tenant)
      .order("name", { ascending: true });
    if (error) {
      setMsg(error.message);
      return;
    }
    setOperators(
      (data ?? []).map((x) => ({
        id: String(x.id),
        name: String(x.name),
        password: String(x.password ?? ""),
        active: Boolean(x.active),
      })),
    );
  }, [supabase]);

  useEffect(() => {
    if (!ready) return;
    void loadOperators();
  }, [ready, loadOperators]);

  const openCreateOperator = () => {
    setEditingOp(null);
    setOpFormName("");
    setOpFormPassword("");
    setOpModalOpen(true);
  };

  const openEditOperator = (op: OperatorRow) => {
    setEditingOp(op);
    setOpFormName(op.name);
    setOpFormPassword(op.password);
    setOpModalOpen(true);
  };

  const saveOperator = async () => {
    const name = opFormName.trim();
    if (!name) {
      setMsg("請輸入人員名稱");
      return;
    }
    setBusy(true);
    setMsg(null);
    const tenant = getEffectiveTenantSlug();
    try {
      let error: { message: string } | null = null;
      if (editingOp) {
        ({ error } = await supabase
          .from("warehouse_operators")
          .update({
            name,
            password: opFormPassword,
            company_id: tenant,
          })
          .eq("id", editingOp.id));
      } else {
        ({ error } = await supabase
          .from("warehouse_operators")
          .insert({
            name,
            password: opFormPassword,
            active: true,
            company_id: tenant,
          }));
      }
      if (error) throw new Error(error.message);
      setOpModalOpen(false);
      await loadOperators();
      setMsg("人員資料已儲存");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setBusy(false);
    }
  };

  const deleteOperator = async (id: string) => {
    if (!window.confirm("確定刪除此人員？")) return;
    setBusy(true);
    setMsg(null);
    try {
      const { error } = await supabase.from("warehouse_operators").delete().eq("id", id);
      if (error) throw new Error(error.message);
      await loadOperators();
      setMsg("人員已刪除");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "刪除失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main
      aria-busy={busy}
      className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-5 p-6"
    >
      <WarehouseSupervisorNav />
      <header className="flex items-center justify-between">
        <div>
          <AppBrandHeader section="倉管員設定" align="left" />
          <p className="mt-2 text-xs font-black text-blue-700">版本：{APP_VERSION}</p>
          <p className="mt-1 text-sm font-semibold text-slate-600">
            現場 QR／手輸內容即<strong>料號（item_no）</strong>，與後台派單品項比對；大批量派單請於管理後台上傳 Excel。盤點模式（盲盤／核對）於<strong>派單匯入</strong>時依任務設定，同一批次可混用。
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 text-right">
          <button
            type="button"
            onClick={() => router.push(withTenantParam("/admin"))}
            className="text-sm font-bold text-slate-600 underline"
          >
            回到倉儲主管
          </button>
        </div>
      </header>

      {msg && (
        <div className="rounded-xl bg-slate-900 p-4 text-white font-black">{msg}</div>
      )}

      {ready && (
        <>
          <section className="rounded-xl bg-white p-4 shadow">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xl font-black">倉管員設定</h2>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={openCreateOperator}
                  className="h-[46px] rounded-lg bg-blue-700 px-4 text-white font-black"
                >
                  新增人員
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm font-bold">
                <thead>
                  <tr className="border-b border-slate-300">
                    <th className="py-3 pr-3">姓名</th>
                    <th className="py-3 pr-3">狀態</th>
                    <th className="py-3 pr-3">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {operators.map((op) => (
                    <tr key={op.id} className="border-b border-slate-200">
                      <td className="py-3 pr-3">{op.name}</td>
                      <td className="py-3 pr-3">{op.active ? "啟用" : "停用"}</td>
                      <td className="py-3 pr-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            title="產生此人專用進場 QR"
                            disabled={!op.active}
                            onClick={() => setQrTarget(op)}
                            className="min-h-[40px] rounded-lg border-2 border-emerald-700 bg-emerald-50 px-3 py-2 text-sm font-black text-emerald-950 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            進場 QR
                          </button>
                          <button onClick={() => openEditOperator(op)} className="rounded bg-blue-700 px-3 py-2 text-white">
                            編輯
                          </button>
                          <button onClick={() => void deleteOperator(op.id)} className="rounded bg-red-700 px-3 py-2 text-white">
                            刪除
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

        </>
      )}

      {qrTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-xl font-black text-slate-900">
              倉儲進場 QR · {qrTarget.name}
            </h3>
            <p className="mt-2 text-sm font-semibold leading-relaxed text-slate-600">
              此 QR 僅連結至<strong> {qrTarget.name} </strong>
              的登入入口：掃描後會開啟首頁並自動帶入帳號，請再輸入密碼登入，登入成功後可進入倉管員工作台／現場作業。
            </p>
            <div className="mt-4 flex justify-center rounded-xl bg-white p-4 ring-1 ring-slate-200">
              <QRCodeSVG
                value={buildOperatorEntryUrl(qrTarget.name)}
                size={220}
                level="M"
              />
            </div>
            <p className="mt-3 break-all text-center text-xs font-bold text-slate-500">
              {buildOperatorEntryUrl(qrTarget.name)}
            </p>
            <button
              type="button"
              onClick={() => setQrTarget(null)}
              className="mt-5 min-h-[48px] w-full rounded-xl bg-slate-900 font-black text-white"
            >
              關閉
            </button>
          </div>
        </div>
      ) : null}

      {opModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-2xl font-black">{editingOp ? "編輯人員" : "新增人員"}</h3>
            <div className="mt-4 grid gap-3">
              <input
                className="min-h-[52px] rounded-xl border border-slate-300 px-3 font-bold"
                placeholder="姓名"
                value={opFormName}
                onChange={(e) => setOpFormName(e.target.value)}
              />
              <input
                className="min-h-[52px] rounded-xl border border-slate-300 px-3 font-bold"
                placeholder="密碼"
                value={opFormPassword}
                onChange={(e) => setOpFormPassword(e.target.value)}
              />
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button onClick={() => setOpModalOpen(false)} className="min-h-[50px] rounded-xl bg-slate-200 font-black">
                取消
              </button>
              <button onClick={() => void saveOperator()} className="min-h-[50px] rounded-xl bg-blue-700 font-black text-white">
                儲存
              </button>
            </div>
          </div>
        </div>
      )}

    </main>
  );
}
