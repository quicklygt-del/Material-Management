"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clearSessionUser, getSessionUser } from "@/lib/auth";
import {
  parseExcelFirstSheet,
  type ParsedSheet,
} from "@/lib/excelSheet";
import {
  aggregatePickingLogQtyByOrders,
  normPairPart,
  orderGroupKey,
  pairKey,
} from "@/lib/pickingAgg";
import {
  downloadPickingLogsCsv,
  fetchTodayPickingLogs,
} from "@/lib/pickingExport";
import { isPickingLogMismatch } from "@/lib/pickingLogRules";
import { AppBrandHeader } from "@/components/AppBrandHeader";
import { getSupabaseBrowserClient } from "@/lib/supabase";
import { APP_VERSION } from "@/lib/version";

type OperationType = "inbound" | "outbound" | "stocktake";

type MonitorRow = {
  monitor_key: string;
  /** 同單號下可能有多種單據類型，於此列並列顯示 */
  types_summary: string;
  order_no: string;
  required_total: number;
  picked_total: number;
  progress_pct: number;
  mismatch_today: number;
  exported_ok: boolean;
  owners: string;
};

type ImportedTaskRow = {
  id: string;
  order_no: string;
  item_no: string;
  required_qty: number;
  picked_qty: number;
  status: string;
  operation_type: string;
  /** 僅 stocktake：true＝盲盤 */
  is_blind_count?: boolean;
  assigned_operator: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  created_at?: string | null;
  item_name?: string;
};

type OperatorRow = {
  id: string;
  name: string;
  active: boolean;
  password: string;
};

const SYNC_WAREHOUSE_OPERATORS_SQL = `alter table public.warehouse_operators add column if not exists active boolean not null default true;
alter table public.warehouse_operators add column if not exists password text not null default '';`;

function guessColumnIndex(labels: string[], needles: string[]): number {
  const norm = (s: string) =>
    s.replace(/\uFEFF/g, "").trim().toLowerCase();
  for (let i = 0; i < labels.length; i += 1) {
    const h = norm(labels[i]);
    if (needles.some((n) => h.includes(norm(n)))) return i;
  }
  return -1;
}

/** 盤點模式欄位：true＝盲盤；false＝核對。raw 空則用 defaultBlind。 */
function parseBlindCountCell(raw: unknown, defaultBlind: boolean): boolean {
  if (raw == null) return defaultBlind;
  if (typeof raw === "boolean") return raw;
  const s = String(raw).replace(/\uFEFF/g, "").trim();
  if (!s) return defaultBlind;
  const low = s.toLowerCase().replace(/,/g, "");
  if (/^(1|y|yes|true|t|是)$/.test(low)) return true;
  if (/^(0|n|no|false|f|否)$/.test(low)) return false;
  if (/^\d+$/.test(low)) {
    const n = Number(low);
    if (n === 1) return true;
    if (n === 0) return false;
  }
  if (/盲/.test(s) && !/核對|對帳/.test(s)) return true;
  if (/核對|對帳/.test(s)) return false;
  return defaultBlind;
}

function guessBlindCountColumnIndex(labels: string[]): number {
  return guessColumnIndex(labels, [
    "is_blind_count",
    "blind_count",
    "stocktake_blind",
    "盤點模式",
    "盲盘",
    "盲盤",
  ]);
}

function guessTaskColumnIndexes(labels: string[]) {
  const order = guessColumnIndex(labels, [
    "order_no",
    "單號",
    "訂單",
    "order no",
    "單據號",
  ]);
  const item = guessColumnIndex(labels, [
    "item_no",
    "item no",
    "itemno",
    "料",
    "料號",
    "品號",
  ]);
  const itemName = guessColumnIndex(labels, [
    "item_name",
    "item name",
    "name",
    "品名",
    "名",
    "名稱",
  ]);
  const qty = guessColumnIndex(labels, [
    "required_qty",
    "required qty",
    "qty",
    "quantity",
    "數",
    "數量",
    "需求",
  ]);
  const location = guessColumnIndex(labels, ["location", "loc", "儲", "儲位", "庫位"]);
  const opType = guessColumnIndex(labels, [
    "operation_type",
    "作業類型",
    "單據類型",
    "類型",
  ]);
  return { order, item, itemName, qty, location, opType };
}

function normalizeStoredOperationType(raw: unknown): OperationType {
  const s = String(raw ?? "").trim();
  if (s === "inbound" || s === "stocktake" || s === "outbound") return s;
  return "outbound";
}

function operationTypeLabel(op: OperationType): string {
  if (op === "inbound") return "📥 入庫單";
  if (op === "stocktake") return "📋 盤點單";
  return "📦 檢貨單";
}

function groupCardDomId(orderNo: string) {
  return `order-card-${orderGroupKey(orderNo).replace(/[^\w\-]+/g, "_")}`;
}

function operationTypesSummaryFromItems(items: ImportedTaskRow[]): string {
  const s = new Set<OperationType>();
  for (const t of items) {
    s.add(normalizeStoredOperationType(t.operation_type));
  }
  const arr = Array.from(s);
  arr.sort((a, b) => operationTypeLabel(a).localeCompare(operationTypeLabel(b)));
  return arr.map(operationTypeLabel).join(" · ");
}

export default function AdminPage() {
  const SHOW_SETTINGS_ON_HOME = false;
  const [ready, setReady] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<MonitorRow[]>([]);
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [mapOpen, setMapOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedSheet | null>(null);
  const [idxOrder, setIdxOrder] = useState(-1);
  const [idxItem, setIdxItem] = useState(-1);
  const [idxQty, setIdxQty] = useState(-1);
  const [idxTaskItemName, setIdxTaskItemName] = useState(-1);
  const [idxBlindCount, setIdxBlindCount] = useState(-1);
  /** 派單匯入為盤點單時，Excel 無欄對應時的預設：false＝核對 */
  const [stocktakeImportBlindDefault, setStocktakeImportBlindDefault] =
    useState(false);
  const [operators, setOperators] = useState<string[]>([]);
  const [operatorRows, setOperatorRows] = useState<OperatorRow[]>([]);
  const [opModalOpen, setOpModalOpen] = useState(false);
  const [editingOp, setEditingOp] = useState<OperatorRow | null>(null);
  const [opFormName, setOpFormName] = useState("");
  const [opFormPassword, setOpFormPassword] = useState("");
  const [schemaFixNeeded, setSchemaFixNeeded] = useState(false);
  const [importedTasks, setImportedTasks] = useState<ImportedTaskRow[]>([]);
  const [historyTasks, setHistoryTasks] = useState<ImportedTaskRow[]>([]);
  const [taskDetail, setTaskDetail] = useState<ImportedTaskRow | null>(null);
  /** 依單號對焦／展開（與看板群組鍵一致） */
  const [importFocusGroupKeys, setImportFocusGroupKeys] = useState<string[]>([]);
  const [expandedImportGroups, setExpandedImportGroups] = useState<Set<string>>(() => new Set());
  const [classificationOpen, setClassificationOpen] = useState(false);
  const [chosenImportOpType, setChosenImportOpType] = useState<OperationType | null>(null);
  type PendingPickImport = {
    sheet: ParsedSheet;
    idxOrder: number;
    idxItem: number;
    idxQty: number;
    idxTaskItemName: number;
    idxBlindCount: number;
  };
  const [pendingPickImport, setPendingPickImport] = useState<PendingPickImport | null>(null);
  const pickingExcelInputRef = useRef<HTMLInputElement>(null);
  /** 匯入成功後短暫高亮對應單據卡片 */
  const [flashImportGroupKeys, setFlashImportGroupKeys] = useState<Set<string>>(
    () => new Set(),
  );

  const resetExcelFileInputs = useCallback(() => {
    if (pickingExcelInputRef.current) pickingExcelInputRef.current.value = "";
  }, []);

  const logout = () => {
    clearSessionUser();
    window.location.href = "/";
  };

  useEffect(() => {
    const user = getSessionUser();
    if (!user || user.role !== "admin") {
      setMsg("僅管理員可進入後台。請先回首頁登入管理員帳號。");
      return;
    }
    setReady(true);
  }, []);

  const loadOperators = useCallback(async () => {
    const { data, error } = await supabase
      .from("warehouse_operators")
      .select("id,name,active,password")
      .order("name", { ascending: true });
    if (error) {
      if (error.message.includes("active") || error.message.includes("password")) {
        setSchemaFixNeeded(true);
        const fallback = await supabase
          .from("warehouse_operators")
          .select("id,name")
          .order("name", { ascending: true });
        if (fallback.error) {
          setMsg(fallback.error.message);
          return;
        }
        const rows = (fallback.data ?? []).map((x) => ({
          id: String(x.id),
          name: String(x.name),
          active: true,
          password: "",
        }));
        setOperatorRows(rows);
        const names = rows.map((x) => x.name);
        setOperators(names);
        setMsg(
          "warehouse_operators 缺少 active/password，請先執行下方 SQL 同步欄位。",
        );
        return;
      }
      setMsg(error.message);
      return;
    }
    setSchemaFixNeeded(false);
    const rows = (data ?? []).map((x) => ({
      id: String(x.id),
      name: String(x.name),
      active: Boolean(x.active),
      password: String(x.password ?? ""),
    }));
    setOperatorRows(rows);
    const names = rows.filter((x) => x.active).map((x) => x.name);
    setOperators(names);
  }, [supabase]);

  const loadImportedTasks = useCallback(async () => {
    const taskSelectVariants = [
      "id,order_no,item_no,item_name,required_qty,status,operation_type,is_blind_count,assigned_operator,started_at,ended_at,created_at",
      "id,order_no,item_no,required_qty,status,operation_type,is_blind_count,assigned_operator,started_at,ended_at,created_at",
      "id,order_no,item_no,item_name,required_qty,status,operation_type,assigned_operator,started_at,ended_at,created_at",
      "id,order_no,item_no,required_qty,status,operation_type,assigned_operator,started_at,ended_at,created_at",
    ];
    let tasksRes = await supabase
      .from("picking_tasks")
      .select(taskSelectVariants[0])
      .order("created_at", { ascending: false })
      .limit(5000);
    for (let vi = 1; vi < taskSelectVariants.length; vi += 1) {
      if (!tasksRes.error) break;
      const em = tasksRes.error.message;
      if (!em.includes("item_name") && !em.includes("is_blind_count")) break;
      tasksRes = await supabase
        .from("picking_tasks")
        .select(taskSelectVariants[vi])
        .order("created_at", { ascending: false })
        .limit(5000);
    }
    const { data: tasks, error: tErr } = tasksRes;
    if (tErr) {
      setMsg(tErr.message);
      return;
    }
    const base = (tasks ?? []) as unknown as Record<string, unknown>[];
    const scopedOrders = Array.from(
      new Set(
        base
          .map((t) =>
            String((t["order_no"] as string | undefined) ?? "").trim(),
          )
          .filter(Boolean),
      ),
    );
    let picked: Map<string, number>;
    try {
      picked = await aggregatePickingLogQtyByOrders(supabase, scopedOrders);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "讀取對照資料失敗");
      return;
    }
    const mapped = base.map((t) => {
      const raw = t;
      const itemNameStored = normPairPart(raw["item_name"]);
      const byPair = picked.get(pairKey(raw["order_no"], raw["item_no"])) ?? 0;
      return {
        id: String(raw["id"]),
        order_no: String(raw["order_no"]),
        item_no: String(raw["item_no"]),
        required_qty: Number(raw["required_qty"] ?? 0),
        picked_qty: byPair,
        status: String(raw["status"] ?? "pending"),
        operation_type: String(raw["operation_type"] ?? ""),
        assigned_operator: raw["assigned_operator"]
          ? String(raw["assigned_operator"])
          : null,
        started_at: raw["started_at"] ? String(raw["started_at"]) : null,
        ended_at: raw["ended_at"] ? String(raw["ended_at"]) : null,
        created_at: raw["created_at"] ? String(raw["created_at"]) : null,
        item_name: itemNameStored || "未命名料件",
        is_blind_count:
          typeof raw["is_blind_count"] === "boolean"
            ? (raw["is_blind_count"] as boolean)
            : undefined,
      };
    });
    const active = mapped.filter(
      (t) => t.status !== "completed" && t.picked_qty < t.required_qty,
    );
    const history = mapped.filter(
      (t) => t.status === "completed" || t.picked_qty >= t.required_qty,
    );
    setImportedTasks(active);
    setHistoryTasks(history);
  }, [supabase]);

  useEffect(() => {
    if (!importFocusGroupKeys.length) return;
    setFlashImportGroupKeys(new Set(importFocusGroupKeys));
    const t = window.setTimeout(() => setFlashImportGroupKeys(new Set()), 1400);
    return () => window.clearTimeout(t);
  }, [importFocusGroupKeys]);

  const loadDashboard = useCallback(async () => {
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth();
    const d = today.getDate();
    const startIso = new Date(y, m, d, 0, 0, 0).toISOString();
    const endIso = new Date(y, m, d + 1, 0, 0, 0).toISOString();

    const [{ data: tasksRaw, error: tErr }, todayRes] = await Promise.all([
      supabase
        .from("picking_tasks")
        .select(
          "order_no,item_no,required_qty,is_exported,assigned_operator,operation_type",
        ),
      supabase
        .from("picking_logs")
        .select("order_no,item_no,actual_qty,variance_note")
        .gte("created_at", startIso)
        .lt("created_at", endIso),
    ]);
    if (tErr) {
      if (!tErr.message.includes("is_exported")) {
        setMsg(tErr.message);
        return;
      }
    }
    let tasks = tasksRaw;
    if (tErr) {
      const fallback = await supabase
        .from("picking_tasks")
        .select("order_no,item_no,required_qty");
      if (fallback.error) {
        setMsg(fallback.error.message);
        return;
      }
      tasks = (fallback.data ?? []).map((x) => ({
        ...x,
        is_exported: false,
        assigned_operator: null,
        operation_type:
          (x as { operation_type?: string }).operation_type ?? "outbound",
      }));
    }
    let todayLogs = todayRes.data;
    let tlErr = todayRes.error;
    if (tlErr?.message.includes("variance_note")) {
      const fallback = await supabase
        .from("picking_logs")
        .select("order_no,item_no,actual_qty")
        .gte("created_at", startIso)
        .lt("created_at", endIso);
      todayLogs = (fallback.data ?? []).map((x) => ({ ...x, variance_note: null }));
      tlErr = fallback.error;
    }
    if (tlErr) {
      setMsg(tlErr.message);
      return;
    }

    const mm = new Map<string, number>();
    for (const lg of todayLogs ?? []) {
      if (!isPickingLogMismatch(lg)) continue;
      const k = orderGroupKey(lg.order_no);
      mm.set(k, (mm.get(k) ?? 0) + 1);
    }

    const tasksList = tasks ?? [];
    const distinctOrdersForAgg = Array.from(
      new Set(
        tasksList
          .map((x) => String((x as { order_no?: string }).order_no ?? "").trim())
          .filter(Boolean),
      ),
    );

    let actualByPair = new Map<string, number>();
    try {
      actualByPair = await aggregatePickingLogQtyByOrders(
        supabase,
        distinctOrdersForAgg,
      );
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "彙總撿貨紀錄失敗");
      return;
    }

    const byGroup = new Map<
      string,
      {
        order_no: string;
        req: number;
        pick: number;
        exported: boolean;
        owners: Set<string>;
        types: Set<OperationType>;
      }
    >();
    for (const t of tasks ?? []) {
      const o = orderGroupKey(t.order_no);
      const op = normalizeStoredOperationType(
        (t as { operation_type?: unknown }).operation_type,
      );
      const gKey = orderGroupKey(t.order_no);
      const pk = pairKey(t.order_no, t.item_no);
      const pickedLine = actualByPair.get(pk) ?? 0;
      const cur = byGroup.get(gKey) ?? {
        order_no: o,
        req: 0,
        pick: 0,
        exported: true,
        owners: new Set<string>(),
        types: new Set<OperationType>(),
      };
      cur.types.add(op);
      cur.req += Number(t.required_qty ?? 0);
      cur.pick += pickedLine;
      cur.exported = cur.exported && Boolean((t as { is_exported?: boolean }).is_exported);
      const owner = String((t as { assigned_operator?: unknown }).assigned_operator ?? "").trim();
      if (owner) cur.owners.add(owner);
      byGroup.set(gKey, cur);
    }

    const result: MonitorRow[] = Array.from(byGroup.entries()).map(([gKey, sums]) => {
      const pct =
        sums.req > 0
          ? Math.min(100, Math.round((sums.pick / sums.req) * 100))
          : 0;
      const typeArr = Array.from(sums.types);
      typeArr.sort((a, b) => operationTypeLabel(a).localeCompare(operationTypeLabel(b)));
      const types_summary = typeArr.map(operationTypeLabel).join(" · ");
      return {
        monitor_key: gKey,
        types_summary,
        order_no: sums.order_no,
        required_total: sums.req,
        picked_total: sums.pick,
        progress_pct: pct,
        mismatch_today: mm.get(orderGroupKey(sums.order_no)) ?? 0,
        exported_ok: sums.exported,
        owners: Array.from(sums.owners).join(" / ") || "未指派",
      };
    });
    result.sort((a, b) => a.order_no.localeCompare(b.order_no));
    setRows(result);
  }, [supabase]);

  const runRetentionCleanup = useCallback(async () => {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from("picking_logs").delete().lt("created_at", cutoff);
    await supabase.from("picking_tasks").delete().lt("created_at", cutoff);
  }, [supabase]);

  useEffect(() => {
    if (!ready) return;
    void runRetentionCleanup();
    void loadDashboard();
    void loadOperators();
    void loadImportedTasks();
  }, [ready, loadDashboard, loadOperators, loadImportedTasks, runRetentionCleanup]);

  const openPickingExcelMapping = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const sheet = await parseExcelFirstSheet(file);
      if (!sheet.columnLabels.length || !sheet.dataRows.length) {
        setMsg("Excel 無法讀取有效列，請檢查工作表");
        return;
      }
      setPendingFile(file);
      setParsed(sheet);
      const labels = sheet.columnLabels;
      setIdxOrder(guessColumnIndex(labels, ["order_no", "單號", "訂單"]));
      setIdxItem(guessColumnIndex(labels, ["item_no", "料號", "品號", "物料"]));
      setIdxQty(guessColumnIndex(labels, ["required_qty", "數量", "qty", "需求"]));
      setIdxTaskItemName(
        guessColumnIndex(labels, ["item_name", "品名", "名稱", "品項名稱"]),
      );
      const guessedIdxBlind = guessBlindCountColumnIndex(labels);
      setIdxBlindCount(guessedIdxBlind);
      const guessed = guessTaskColumnIndexes(labels);
      const guessedIdxOrder = guessed.order;
      const guessedIdxItem = guessed.item;
      const guessedIdxQty = guessed.qty;
      const guessedIdxTaskItemName = guessed.itemName;
      const canParseTaskCols = guessedIdxItem >= 0 && guessedIdxQty >= 0;
      if (canParseTaskCols) {
        setChosenImportOpType(null);
        setPendingPickImport({
          sheet,
          idxOrder: guessedIdxOrder,
          idxItem: guessedIdxItem,
          idxQty: guessedIdxQty,
          idxTaskItemName: guessedIdxTaskItemName,
          idxBlindCount: guessedIdxBlind,
        });
        setClassificationOpen(true);
      } else {
        const missing: string[] = [];
        if (guessedIdxItem < 0) missing.push("料號(item_no)");
        if (guessedIdxQty < 0) missing.push("數量(required_qty)");
        setMsg(
          `派單匯入需標題含 ${missing.join("、")}，請確認 Excel 標頭後直接重傳；或依提示手動對應欄位。`,
        );
        setMapOpen(true);
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "讀檔失敗");
    } finally {
      setBusy(false);
      resetExcelFileInputs();
    }
  };

  const runPickingTasksImport = async (
    forcedClassification: OperationType,
    sourceParsed: ParsedSheet | null = parsed,
    sourceIdxOrder: number = idxOrder,
    sourceIdxItem: number = idxItem,
    sourceIdxQty: number = idxQty,
    sourceIdxTaskItemName: number = idxTaskItemName,
    sourceIdxBlindCount: number = idxBlindCount,
    stocktakeBlindFallback: boolean = stocktakeImportBlindDefault,
  ) => {
    if (!sourceParsed || sourceIdxItem < 0 || sourceIdxQty < 0) {
      setMsg("請選擇 item_no(item_no)、required_qty 對應欄位（單號可向下填充或由檔案中讀取）");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const opType: OperationType = forcedClassification;

      const { data: existingTaskTypes } = await supabase
        .from("picking_tasks")
        .select("order_no,operation_type");
      const typesByOrder = new Map<string, Set<OperationType>>();
      for (const r of existingTaskTypes ?? []) {
        const on = orderGroupKey(String(r.order_no));
        const ex = normalizeStoredOperationType(r.operation_type);
        if (!typesByOrder.has(on)) typesByOrder.set(on, new Set());
        typesByOrder.get(on)!.add(ex);
      }

      let inserted = 0;
      const badRows: string[] = [];
      let skippedTypeMismatch = 0;
      let skippedDuplicateRows = 0;
      let otherInsertFailures = 0;
      const duplicateOrderNos = new Set<string>();
      const importedGroupKeys = new Set<string>();

      type ParsedExcelLine = {
        order_no: string;
        item_no: string;
        required_qty: number;
        excel_item_name: string;
        /** 僅於 opType===stocktake 時寫入 DB */
        is_blind_count: boolean;
      };

      let lastCanonOrder = "";
      const parsedLines: ParsedExcelLine[] = [];
      for (let i = 0; i < sourceParsed.dataRows.length; i += 1) {
        const row = sourceParsed.dataRows[i];
        const orderRaw =
          sourceIdxOrder >= 0 ? String(row[sourceIdxOrder] ?? "").trim() : "";
        const cellCanon = orderRaw ? orderGroupKey(orderRaw) : "";
        const order_no = cellCanon || lastCanonOrder;
        const item_no = (row[sourceIdxItem] ?? "").trim();
        const excelItemName =
          sourceIdxTaskItemName >= 0 ? String(row[sourceIdxTaskItemName] ?? "").trim() : "";
        const qRaw = row[sourceIdxQty];
        const required_qty =
          typeof qRaw === "string"
            ? parseFloat(qRaw.replace(/,/g, ""))
            : Number(qRaw);
        if (cellCanon) lastCanonOrder = cellCanon;
        const rowNo = i + 2;
        if (!item_no || !Number.isFinite(required_qty) || required_qty <= 0) {
          const missingFields: string[] = [];
          if (!item_no) missingFields.push("料號");
          if (!Number.isFinite(required_qty) || required_qty <= 0) {
            missingFields.push("數量");
          }
          badRows.push(`第 ${rowNo} 列：缺少${missingFields.join("與")}`);
          continue;
        }
        if (!order_no) {
          badRows.push(`第 ${rowNo} 列：缺少單號，且上方無可繼承單號`);
          continue;
        }
        const orderNorm = orderGroupKey(order_no);
        const alreadyTypes = typesByOrder.get(orderNorm) ?? new Set<OperationType>();
        if (alreadyTypes.size > 0 && !alreadyTypes.has(opType)) {
          skippedTypeMismatch += 1;
          continue;
        }
        const rowBlindRaw =
          opType === "stocktake" && sourceIdxBlindCount >= 0
            ? row[sourceIdxBlindCount]
            : undefined;
        const is_blind_count =
          opType === "stocktake"
            ? parseBlindCountCell(rowBlindRaw, stocktakeBlindFallback)
            : false;
        parsedLines.push({
          order_no,
          item_no,
          required_qty: Math.floor(required_qty),
          excel_item_name: excelItemName,
          is_blind_count,
        });
      }

      const mergedByPair = new Map<string, ParsedExcelLine>();
      for (const line of parsedLines) {
        const pk = pairKey(line.order_no, line.item_no);
        const cur = mergedByPair.get(pk);
        if (!cur) {
          mergedByPair.set(pk, { ...line });
        } else {
          cur.required_qty += line.required_qty;
          if (!cur.excel_item_name.trim() && line.excel_item_name.trim()) {
            cur.excel_item_name = line.excel_item_name;
          }
          // 同一單同料合併：任一向為盲盤則採盲盤（較嚴謹）
          cur.is_blind_count = Boolean(cur.is_blind_count || line.is_blind_count);
        }
      }
      const excelRowsMerged =
        parsedLines.length - mergedByPair.size;

      for (const line of Array.from(mergedByPair.values())) {
        const order_no = line.order_no;
        const item_no = line.item_no;
        const rq = line.required_qty;
        const excelItemName = line.excel_item_name.trim();
        const orderNorm = orderGroupKey(order_no);
        const item_name =
          excelItemName || item_no.trim() || "未命名料件";
        const payload: Record<string, unknown> = {
          order_no,
          item_no,
          required_qty: rq,
          status: "pending" as const,
          operation_type: opType,
          assigned_operator: null as string | null,
          item_name,
        };
        if (opType === "stocktake") {
          payload.is_blind_count = line.is_blind_count;
        }
        let { error } = await supabase.from("picking_tasks").insert(payload);
        if (error?.message.includes("item_name")) {
          delete payload.item_name;
          ({ error } = await supabase.from("picking_tasks").insert(payload));
        }
        if (error?.message.includes("is_blind_count")) {
          delete payload.is_blind_count;
          ({ error } = await supabase.from("picking_tasks").insert(payload));
        }
        if (error) {
          const em = (error.message || "").toLowerCase();
          const looksLikeDuplicateKey =
            em.includes("duplicate") ||
            em.includes("unique") ||
            em.includes("23505") ||
            em.includes("already exists") ||
            em.includes("order_no") ||
            /violates.*key/i.test(em);
          if (looksLikeDuplicateKey) {
            skippedDuplicateRows += 1;
            duplicateOrderNos.add(order_no);
          } else {
            otherInsertFailures += 1;
          }
          continue;
        }
        inserted += 1;
        importedGroupKeys.add(orderGroupKey(order_no));
        if (!typesByOrder.has(orderNorm)) typesByOrder.set(orderNorm, new Set());
        typesByOrder.get(orderNorm)!.add(opType);
      }

      const badFormatCount = badRows.length;
      if (
        inserted === 0 &&
        badFormatCount > 0 &&
        skippedTypeMismatch === 0 &&
        skippedDuplicateRows === 0 &&
        otherInsertFailures === 0
      ) {
        setMapOpen(false);
        setClassificationOpen(false);
        setPendingPickImport(null);
        setChosenImportOpType(null);
        setMsg(
          `【無新增】派單欄位檢查未通過：${badRows[0]}（共 ${badFormatCount} 筆列需修正後再匯入）。`,
        );
        return;
      }

      const docCount = importedGroupKeys.size;
      const headline =
        inserted > 0
          ? `已成功匯入 ${docCount} 張單據，共 ${inserted} 筆品項明細。（${operationTypeLabel(opType)}）`
          : `【無新增】本次未新增任何品項明細。（${operationTypeLabel(opType)}）`;

      const stats: string[] = [];
      if (excelRowsMerged > 0) {
        stats.push(
          `同單同料之重複 Excel 列已加總合併，共合併 ${excelRowsMerged} 列`,
        );
      }
      if (badFormatCount > 0) {
        stats.push(`略過 ${badFormatCount} 筆欄位或格式不正確的列`);
      }
      if (skippedTypeMismatch > 0) {
        stats.push(`略過 ${skippedTypeMismatch} 筆因單號已有其它單據類型而無法併入的列`);
      }
      if (skippedDuplicateRows > 0) {
        stats.push(`略過 ${skippedDuplicateRows} 筆已存在的重複單號`);
        const orders = Array.from(duplicateOrderNos);
        if (orders.length === 1) {
          stats.push(`此單號 ${orders[0]} 已存在，若要更新請先刪除舊單。`);
        } else if (orders.length > 1) {
          const sample = orders.slice(0, 5).join("、");
          stats.push(
            orders.length > 5
              ? `下列單號已存在於系統：${sample} 等共 ${orders.length} 張單據。若要更新請先刪除對應舊單。`
              : `下列單號已存在於系統：${sample}。若要更新請先刪除對應舊單。`,
          );
        } else {
          stats.push(`此批資料與系統現有單號衝突，若要更新請先刪除舊單。`);
        }
      }
      if (otherInsertFailures > 0) {
        stats.push(
          `另有 ${otherInsertFailures} 筆未能寫入，請檢查資料表欄位或聯絡系統管理員。`,
        );
      }

      setMsg(stats.length ? `${headline} ${stats.join(" ")}` : headline);

      setMapOpen(false);
      setClassificationOpen(false);
      setPendingPickImport(null);
      setChosenImportOpType(null);
      await loadDashboard();
      await loadImportedTasks();
      if (inserted > 0) {
        await loadImportedTasks();
      }
      const focused = Array.from(importedGroupKeys);
      setImportFocusGroupKeys(focused);
      setExpandedImportGroups((prev) => {
        const next = new Set(prev);
        for (const k of focused) next.add(k);
        return next;
      });
      if (inserted > 0 && focused.length) {
        const domId = groupCardDomId(focused[0]);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            document.getElementById(domId)?.scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
          });
        });
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "派單匯入失敗");
    } finally {
      setBusy(false);
      resetExcelFileInputs();
    }
  };


  const confirmMapping = async () => {
    if (!parsed) return;
    if (idxItem < 0 || idxQty < 0) {
      setMsg("派單對應需指定料號與數量欄位");
      return;
    }
    setChosenImportOpType(null);
    setPendingPickImport({
      sheet: parsed,
      idxOrder,
      idxItem,
      idxQty,
      idxTaskItemName,
      idxBlindCount,
    });
    setMapOpen(false);
    setClassificationOpen(true);
  };

  const onExportLogs = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const lg = await fetchTodayPickingLogs(supabase);
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      downloadPickingLogsCsv(lg, `logs_${y}${m}${day}.csv`);
      setMsg(`已匯出 picking_logs ${lg.length} 筆`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "匯出失敗");
    } finally {
      setBusy(false);
    }
  };

  const onDeleteWholeOrderGroup = async (items: ImportedTaskRow[]) => {
    if (!items.length) return;
    const groupK = orderGroupKey(items[0].order_no);
    const orderLabel = normPairPart(items[0].order_no);
    if (
      !window.confirm(
        `確定要刪除單號 ${orderLabel} 底下所有品項任務（${items.length} 筆，含所有單據類型）嗎？`,
      )
    )
      return;
    setBusy(true);
    setMsg(null);
    try {
      const ids = items.map((x) => x.id);
      const { error } = await supabase
        .from("picking_tasks")
        .delete()
        .in("id", ids);
      if (error) throw new Error(error.message);
      setExpandedImportGroups((prev) => {
        const next = new Set(prev);
        next.delete(groupK);
        return next;
      });
      setImportFocusGroupKeys((prev) =>
        prev.filter((k) => k !== groupK),
      );
      setMsg(`已刪除單號 ${orderLabel} 全單`);
      await loadDashboard();
      await loadImportedTasks();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "刪除整單失敗");
    } finally {
      setBusy(false);
    }
  };

  const openTaskDetail = (t: ImportedTaskRow) => {
    setTaskDetail(t);
  };

  const onClearTodayCompletedLogs = async () => {
    if (
      !window.confirm(
        "確定清除「今日」異動紀錄（整日 picking_logs）與「今日結案」的已完成派單明細（picking_tasks × completed）？\n歷史任務區與監控將一併重算；此動作無法還原。",
      )
    )
      return;
    setBusy(true);
    setMsg(null);
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth();
    const d = today.getDate();
    const startIso = new Date(y, m, d, 0, 0, 0).toISOString();
    const endIso = new Date(y, m, d + 1, 0, 0, 0).toISOString();
    try {
      const { error: logErr } = await supabase
        .from("picking_logs")
        .delete()
        .gte("created_at", startIso)
        .lt("created_at", endIso);
      if (logErr) throw new Error(logErr.message);

      const { error: doneErr } = await supabase
        .from("picking_tasks")
        .delete()
        .eq("status", "completed")
        .gte("ended_at", startIso)
        .lt("ended_at", endIso);
      if (doneErr) throw new Error(doneErr.message);

      const { error: doneFallbackErr } = await supabase
        .from("picking_tasks")
        .delete()
        .eq("status", "completed")
        .is("ended_at", null)
        .gte("created_at", startIso)
        .lt("created_at", endIso);
      if (doneFallbackErr) throw new Error(doneFallbackErr.message);

      setMsg("已清除今日異動紀錄與今日結案之已完成派單明細");
      await loadDashboard();
      await loadImportedTasks();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "清除紀錄失敗");
    } finally {
      setBusy(false);
    }
  };

  /** 依 id 清空「歷史任務區」目前顯示列（資料庫刪除），含非今日結案資料 */
  const onPurgeDisplayedHistoryTasks = async () => {
    if (!historyTasks.length) return;
    if (
      !window.confirm(
        `確定從資料庫刪除歷史任務區所列 ${historyTasks.length} 筆派單明細嗎？\n監控與異動紀錄彙總將一併更新；無法還原。`,
      )
    )
      return;
    setBusy(true);
    setMsg(null);
    try {
      const ids = historyTasks.map((t) => t.id);
      const { error } = await supabase
        .from("picking_tasks")
        .delete()
        .in("id", ids);
      if (error) throw new Error(error.message);
      setMsg(`已刪除歷史任務 ${ids.length} 筆`);
      await loadDashboard();
      await loadImportedTasks();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "刪除歷史任務失敗");
    } finally {
      setBusy(false);
    }
  };

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

  const onSaveOperator = async () => {
    const name = opFormName.trim();
    if (!name) {
      setMsg("請輸入倉管員名稱");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      let error: { message: string } | null = null;
      if (editingOp) {
        ({ error } = await supabase
          .from("warehouse_operators")
          .update({ name, password: opFormPassword })
          .eq("id", editingOp.id));
      } else {
        ({ error } = await supabase.from("warehouse_operators").insert({
          name,
          password: opFormPassword,
          active: true,
        }));
      }
      if (error) throw new Error(error.message);
      setMsg(editingOp ? "倉管員已更新" : "倉管員已新增");
      setOpModalOpen(false);
      await loadOperators();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "儲存倉管員失敗");
    } finally {
      setBusy(false);
    }
  };

  const onDeleteOperator = async (id: string) => {
    if (!window.confirm("確定刪除此倉管員？")) return;
    setBusy(true);
    setMsg(null);
    try {
      const { error } = await supabase
        .from("warehouse_operators")
        .delete()
        .eq("id", id);
      if (error) throw new Error(error.message);
      setMsg("倉管員已刪除");
      await loadOperators();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "刪除倉管員失敗");
    } finally {
      setBusy(false);
    }
  };

  const colOpts = parsed?.columnLabels ?? [];
  const groupedImportedTasks = useMemo(() => {
    const map = new Map<string, ImportedTaskRow[]>();
    for (const task of importedTasks) {
      const k = orderGroupKey(task.order_no);
      const arr = map.get(k) ?? [];
      arr.push(task);
      map.set(k, arr);
    }
    return Array.from(map.entries())
      .map(([groupKey, items]) => {
        const orderNo =
          normPairPart(items[0]?.order_no ?? groupKey) || groupKey;
        const requiredTotal = items.reduce((sum, x) => sum + Number(x.required_qty || 0), 0);
        const pickedTotal = items.reduce((sum, x) => sum + Number(x.picked_qty || 0), 0);
        const doneCount = items.filter((x) => Number(x.picked_qty || 0) >= Number(x.required_qty || 0)).length;
        const pct = requiredTotal > 0 ? Math.min(100, Math.round((pickedTotal / requiredTotal) * 100)) : 0;
        const owners = Array.from(
          new Set(items.map((x) => String(x.assigned_operator ?? "").trim()).filter(Boolean)),
        );
        const typesSummary = operationTypesSummaryFromItems(items);
        return {
          groupKey,
          orderNo,
          typesSummary,
          items,
          requiredTotal,
          pickedTotal,
          doneCount,
          pct,
          ownerValue: owners.length === 1 ? owners[0] : "",
        };
      })
      .sort((a, b) => {
        const aFocused = importFocusGroupKeys.includes(a.groupKey);
        const bFocused = importFocusGroupKeys.includes(b.groupKey);
        if (aFocused && !bFocused) return -1;
        if (!aFocused && bFocused) return 1;
        return a.orderNo.localeCompare(b.orderNo);
      });
  }, [importedTasks, importFocusGroupKeys]);

  const onAssignOrderInline = async (
    items: ImportedTaskRow[],
    operator: string,
  ) => {
    if (!items.length) return;
    const orderLabel =
      normPairPart(items[0].order_no) || orderGroupKey(items[0].order_no);
    const ids = items.map((x) => x.id);
    setMsg(null);
    try {
      const { error } = await supabase
        .from("picking_tasks")
        .update({ assigned_operator: operator || null })
        .in("id", ids);
      if (error) throw new Error(error.message);
      for (const variant of Array.from(
        new Set(items.map((x) => x.order_no)),
      )) {
        const maybeOrder = await supabase
          .from("orders")
          .update({ assigned_operator: operator || null })
          .eq("order_no", variant);
        if (maybeOrder.error && !maybeOrder.error.message.includes('relation "orders"')) {
          throw new Error(maybeOrder.error.message);
        }
      }
      setImportedTasks((prev) =>
        prev.map((t) =>
          ids.includes(t.id) ? { ...t, assigned_operator: operator || null } : t,
        ),
      );
      setHistoryTasks((prev) =>
        prev.map((t) =>
          ids.includes(t.id) ? { ...t, assigned_operator: operator || null } : t,
        ),
      );
      setMsg(
        operator
          ? `已將單號 ${orderLabel} 全單指派給 ${operator}`
          : `已將單號 ${orderLabel} 全單設為未指派`,
      );
      void loadDashboard();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "單號指派更新失敗");
    }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-5 p-6">
      <header className="flex items-center justify-between">
        <div>
          <AppBrandHeader section="管理後台" align="left" />
          <p className="mt-2 text-xs font-black text-blue-700">版本：{APP_VERSION}</p>
        </div>
        <div className="flex flex-wrap gap-4">
          <Link href="/labels" className="font-bold text-indigo-800 underline">
            標籤中心
          </Link>
          <Link href="/admin/warehouses" className="font-bold underline">
            資產分頁
          </Link>
          <Link href="/admin/settings" className="font-bold underline">
            系統設定
          </Link>
          <button
            onClick={logout}
            className="rounded-lg bg-slate-900 px-3 py-1 font-black text-white"
          >
            登出
          </button>
          <Link href="/" className="font-bold underline">
            回首頁
          </Link>
        </div>
      </header>

      {msg && (
        <div
          className={`rounded-xl p-4 text-lg font-black text-white ${
            msg.includes("失敗") || msg.includes("僅管理員")
              ? "bg-red-600"
              : msg.startsWith("【無新增】") || msg.startsWith("本次未新增")
                ? "bg-amber-600"
                : "bg-emerald-600"
          }`}
        >
          {msg}
        </div>
      )}

      <section className={`${SHOW_SETTINGS_ON_HOME ? "rounded-xl bg-white p-4 shadow" : "hidden"}`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-xl font-black">倉管員設定</h2>
          <div className="flex gap-2">
            <button
              disabled={!ready || busy}
              onClick={() => void loadOperators()}
              className="h-[48px] rounded-lg bg-slate-800 px-4 font-black text-white disabled:opacity-40"
            >
              重新整理
            </button>
            <button
              disabled={!ready || busy}
              onClick={openCreateOperator}
              className="h-[48px] rounded-lg bg-blue-700 px-4 font-black text-white disabled:opacity-40"
            >
              新增人員
            </button>
          </div>
        </div>
        {schemaFixNeeded && (
          <div className="mb-4 rounded-xl bg-amber-100 p-4 text-sm font-bold text-amber-900">
            <p className="mb-2">
              偵測到 `warehouse_operators` 缺少欄位，請先在 Supabase SQL Editor 執行：
            </p>
            <pre className="overflow-x-auto rounded bg-white p-3 text-xs">
              {SYNC_WAREHOUSE_OPERATORS_SQL}
            </pre>
          </div>
        )}
        <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
          <table className="min-w-full text-left text-sm font-bold">
            <thead className="bg-slate-50">
              <tr className="border-b border-slate-300">
                <th className="py-3 px-3">姓名</th>
                <th className="py-3 px-3">狀態</th>
                <th className="py-3 px-3">操作</th>
              </tr>
            </thead>
            <tbody>
              {operatorRows.map((op) => (
                <tr key={op.id} className="border-b border-slate-200">
                  <td className="py-3 px-3">{op.name}</td>
                  <td className="py-3 px-3">
                    <span
                      className={`rounded px-2 py-1 text-xs ${
                        op.active
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-200 text-slate-700"
                      }`}
                    >
                      {op.active ? "啟用" : "停用"}
                    </span>
                  </td>
                  <td className="py-3 px-3">
                    <div className="flex gap-2">
                      <button
                        disabled={!ready || busy}
                        onClick={() => openEditOperator(op)}
                        className="min-h-[40px] rounded-lg bg-blue-700 px-3 text-white disabled:opacity-40"
                      >
                        編輯
                      </button>
                      <button
                        disabled={!ready || busy}
                        onClick={() => void onDeleteOperator(op.id)}
                        className="min-h-[40px] rounded-lg bg-red-700 px-3 text-white disabled:opacity-40"
                      >
                        刪除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {operatorRows.length === 0 && (
            <p className="mt-3 text-sm font-bold text-slate-500">尚無倉管員資料</p>
          )}
        </div>
      </section>

      <section className="rounded-xl bg-white p-4 shadow">
        <h2 className="text-xl font-black">Excel：派單（picking_tasks）</h2>
        <p className="mt-1 text-sm font-semibold text-slate-600">
          系統自動辨識標頭並支援單號向下填充；同一單號內若多列為相同料號，會自動加總數量成一筆任務明細。上傳後須確認單據類型（入庫／檢貨／盤點）。盤點單可設「盤點模式：核對／盲盤」於任務層級，同一檔可混用。
          現場作業將 QR／手輸內容直接視為<strong>料號（item_no）</strong>並與下列派單品項比對，無須標籤註冊表。
        </p>
        <label
          className={`mt-3 inline-flex cursor-pointer items-center rounded-xl bg-blue-700 px-5 py-3 text-base font-black text-white shadow ${
            !ready || busy ? "pointer-events-none opacity-50" : ""
          }`}
        >
          <input
            ref={pickingExcelInputRef}
            type="file"
            accept=".xlsx,.xls"
            disabled={!ready || busy}
            className="sr-only"
            onChange={(e) =>
              void openPickingExcelMapping(e.target.files?.[0] ?? null)
            }
          />
          {busy ? "上傳中…" : "選擇 Excel 檔案"}
        </label>
      </section>

      <section className="rounded-xl bg-white p-4 shadow">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-black">進行中任務列表</h2>
          <button
            disabled={!ready || busy}
            onClick={() => void onClearTodayCompletedLogs()}
            className="min-h-[56px] rounded-xl bg-red-700 px-5 text-lg font-black text-white disabled:opacity-40"
          >
            清除今日紀錄與結案派單
          </button>
        </div>
        <p className="mb-3 text-xs font-semibold text-slate-500">
          紅鍵會刪除<strong>整日</strong> picking_logs（含掃錯 0 筆）與<strong>今日結案</strong>
          （ended_at／created_at 落在今日）的 completed 派單明細，並重新載入<strong>監控</strong>
          。僅清空「進行中」區時，請用各單「刪除整單」，否則已結案列仍會留在歷史區。
        </p>
        <p className="mb-3 text-sm font-semibold text-slate-600">
          預設收攏標題列；同一單號僅一張卡片，其下可含多種單據類型之品項列。
        </p>
        <div className="grid gap-1.5">
          {groupedImportedTasks.map((group) => {
            const expanded = expandedImportGroups.has(group.groupKey);
            return (
            <article
              id={groupCardDomId(group.orderNo)}
              key={group.groupKey}
              className={`rounded-lg border px-3 py-1.5 transition-[box-shadow,background-color] duration-300 ${
                flashImportGroupKeys.has(group.groupKey)
                  ? "animate-pulse border-emerald-500 bg-emerald-50 ring-4 ring-emerald-400/90 shadow-[0_0_14px_rgba(52,211,153,0.55)]"
                  : importFocusGroupKeys.includes(group.groupKey)
                    ? "border-blue-600 bg-blue-50 ring-2 ring-blue-300"
                    : "border-slate-200 bg-blue-50/40"
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setExpandedImportGroups((prev) => {
                      const n = new Set(prev);
                      if (n.has(group.groupKey)) n.delete(group.groupKey);
                      else n.add(group.groupKey);
                      return n;
                    })
                  }
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left font-black text-sm text-slate-900 hover:bg-blue-100/70"
                >
                  <span className="shrink-0 text-slate-500">{expanded ? "▼" : "▶"}</span>
                  <span className="truncate">
                    {group.typesSummary}｜{group.orderNo}
                    <span className="font-bold text-slate-600">
                      （共 {group.items.length} 筆品項 · {group.doneCount}/
                      {group.items.length} 已完成）
                    </span>
                  </span>
                </button>
                <select
                  value={group.ownerValue}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    void onAssignOrderInline(group.items, e.target.value)
                  }
                  className="min-h-[36px] min-w-[140px] max-w-[180px] rounded-md border border-slate-300 bg-white px-1.5 text-xs font-black shrink-0"
                >
                  <option value="">指派整單</option>
                  {operators.map((name) => (
                    <option key={`order-${group.groupKey}-${name}`} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <div className="text-xs font-black text-slate-700 whitespace-nowrap">
                  {group.pct}% ｜ {group.pickedTotal}/{group.requiredTotal}
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    void onDeleteWholeOrderGroup(group.items);
                  }}
                  className="shrink-0 rounded-md bg-red-700 px-2 py-1 text-xs font-black text-white disabled:opacity-40"
                >
                  刪除整單
                </button>
              </div>
              {!expanded ? (
                <p className="pl-8 text-[11px] font-bold text-slate-500">
                  進度總覽｜已完成品項：{group.doneCount}/{group.items.length}
                </p>
              ) : (
              <div className="mt-2 space-y-1 border-t border-slate-200/80 pt-2 pl-2">
                {group.items.map((t) => (
                  <button
                    type="button"
                    key={t.id}
                    className="w-full cursor-pointer rounded-md border border-slate-100 bg-white px-2 py-2 text-left text-sm hover:bg-blue-50"
                    onClick={() => openTaskDetail(t)}
                  >
                    <span className="font-bold text-slate-800">
                      {t.item_no}｜{t.item_name || "未命名料件"}
                    </span>
                    <span className="ml-2 font-black text-emerald-800">
                      {t.picked_qty}/{t.required_qty}
                    </span>
                  </button>
                ))}
              </div>
              )}
            </article>
            );
          })}
          {groupedImportedTasks.length === 0 && (
            <p className="mt-4 font-bold text-slate-500">尚無進行中任務</p>
          )}
        </div>
      </section>

      <section className="rounded-xl bg-white p-4 shadow">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-black">歷史任務區（100% / completed）</h2>
          <button
            type="button"
            disabled={!ready || busy || historyTasks.length === 0}
            onClick={() => void onPurgeDisplayedHistoryTasks()}
            className="min-h-[48px] rounded-xl bg-red-700 px-4 text-sm font-black text-white disabled:opacity-40"
          >
            從資料庫刪除本列表
          </button>
        </div>
        <p className="mb-2 text-xs font-semibold text-slate-500">
          本表為「已完成／已達需求量」的 picking_tasks。
          若非今日結案，上方紅鍵不會刪到，請改用此按鈕一次刪除本表所列 id。
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-left text-sm font-bold">
            <thead>
              <tr className="border-b border-slate-300">
                <th className="py-3 pr-3">order_no</th>
                <th className="py-3 pr-3">item_no</th>
                <th className="py-3 pr-3">已完成/需求</th>
                <th className="py-3 pr-3">狀態</th>
              </tr>
            </thead>
            <tbody>
              {historyTasks.map((t) => (
                <tr key={`h-${t.id}`} className="border-b border-slate-200">
                  <td className="py-3 pr-3">{t.order_no}</td>
                  <td className="py-3 pr-3">{t.item_no}</td>
                  <td className="py-3 pr-3">
                    {t.picked_qty} / {t.required_qty}
                  </td>
                  <td className="py-3 pr-3">{t.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {historyTasks.length === 0 && (
            <p className="mt-4 font-bold text-slate-500">尚無歷史任務</p>
          )}
        </div>
      </section>

      <section className="rounded-xl bg-white p-4 shadow">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-black">異動匯出（picking_logs 今日）</h2>
          <button
            disabled={!ready || busy}
            onClick={() => void onExportLogs()}
            className="min-h-[60px] min-w-[200px] rounded-xl bg-slate-900 px-6 text-lg font-black text-white disabled:opacity-40"
          >
            匯出今日 picking_logs（ERP）
          </button>
        </div>
        <p className="mt-2 text-sm font-semibold text-slate-600">
          此區為當日掃描流水帳匯出，檔名格式為 logs_YYYYMMDD.csv。
        </p>
      </section>

      <section className="rounded-xl bg-white p-4 shadow">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xl font-black">監控（依 order_no）</h2>
          <button
            disabled={!ready || busy}
            onClick={() => void loadDashboard()}
            className="h-[52px] rounded-lg bg-slate-800 px-4 font-black text-white"
          >
            重新整理
          </button>
        </div>
        <p className="mb-3 text-sm font-semibold text-slate-600">
          此區依單號彙總進度與下載狀態；同一單號若含多種單據類型，會合併於同一列並於「任務別」並列顯示。
        </p>
        <div className="overflow-x-auto">
          <table className="min-w-full table-fixed text-left text-sm font-bold">
            <thead>
              <tr className="border-b border-slate-300">
                <th className="py-3 pr-3">任務別</th>
                <th className="py-3 pr-3">order_no</th>
                <th className="py-3 pr-3">負責人</th>
                <th className="py-3 pr-3">完成進度</th>
                <th className="py-3 pr-3">已撿/需求</th>
                <th className="py-3 pr-3">是否已下載</th>
                <th className="py-3 pr-3">今日掃錯</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.monitor_key} className="border-b border-slate-200">
                  <td className="py-3 pr-3 whitespace-nowrap">
                    {r.types_summary}
                  </td>
                  <td className="py-3 pr-3 font-black">{r.order_no}</td>
                  <td className="py-3 pr-3">{r.owners}</td>
                  <td className="py-3 pr-3">
                    <span className="rounded-lg bg-emerald-200 px-3 py-2 text-emerald-900">
                      {r.progress_pct}%
                    </span>
                  </td>
                  <td className="py-3 pr-3">
                    {r.picked_total} / {r.required_total}
                  </td>
                  <td className="py-3 pr-3">
                    <span
                      className={`rounded px-2 py-1 text-xs font-black ${
                        r.exported_ok
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {r.exported_ok ? "已下載" : "未下載"}
                    </span>
                  </td>
                  <td className="py-3 pr-3 text-red-700">
                    {r.mismatch_today}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <p className="mt-4 font-bold text-slate-500">尚無 picking_tasks</p>
          )}
        </div>
      </section>

      {opModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-2xl font-black">
              {editingOp ? "編輯倉管員" : "新增倉管員"}
            </h3>
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
              <button
                type="button"
                onClick={() => setOpModalOpen(false)}
                className="min-h-[52px] rounded-xl bg-slate-200 font-black"
              >
                取消
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onSaveOperator()}
                className="min-h-[52px] rounded-xl bg-blue-700 font-black text-white disabled:opacity-40"
              >
                儲存
              </button>
            </div>
          </div>
        </div>
      )}

      {taskDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-2xl font-black">{taskDetail.order_no}</h3>
            <div className="mt-4 grid gap-3 text-lg font-black text-slate-800">
              <div>{taskDetail.item_no}</div>
              <div>{taskDetail.item_name || "未命名料件"}</div>
              <div>應作業數量：{taskDetail.required_qty}</div>
              {normalizeStoredOperationType(taskDetail.operation_type) ===
                "stocktake" && (
                <div className="text-base text-amber-950">
                  盤點模式：
                  {taskDetail.is_blind_count ? "盲盤" : "核對"}
                </div>
              )}
            </div>
            <div className="mt-5">
              <button
                onClick={() => setTaskDetail(null)}
                className="min-h-[52px] w-full rounded-xl bg-slate-200 font-black"
              >
                關閉
              </button>
            </div>
          </div>
        </div>
      )}

      {classificationOpen && pendingPickImport && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-2xl font-black">確認單據類型</h3>
            <p className="mt-2 text-sm font-semibold text-slate-600">
              請為此檔案的任務選擇類型。系統將依此將所有列寫入相同之 operation_type，並與其它類型單據完全分流。
            </p>
            <div className="mt-4 grid gap-3 font-black text-slate-900">
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-slate-200 px-3 py-3 has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50">
                <input
                  type="radio"
                  name="import-class"
                  checked={chosenImportOpType === "inbound"}
                  onChange={() => setChosenImportOpType("inbound")}
                  className="h-5 w-5 accent-blue-700"
                />
                📥 入庫單
              </label>
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-slate-200 px-3 py-3 has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50">
                <input
                  type="radio"
                  name="import-class"
                  checked={chosenImportOpType === "outbound"}
                  onChange={() => setChosenImportOpType("outbound")}
                  className="h-5 w-5 accent-blue-700"
                />
                📦 檢貨單（出貨／領料）
              </label>
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-slate-200 px-3 py-3 has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50">
                <input
                  type="radio"
                  name="import-class"
                  checked={chosenImportOpType === "stocktake"}
                  onChange={() => setChosenImportOpType("stocktake")}
                  className="h-5 w-5 accent-blue-700"
                />
                📋 盤點單
              </label>
            </div>
            {chosenImportOpType === "stocktake" && (
              <div className="mt-4 rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
                <p className="text-sm font-black text-amber-950">
                  盤點模式預設（核對／盲盤）
                </p>
                <p className="mt-2 text-xs font-semibold text-slate-700">
                  若 Excel 未對應「盤點模式／is_blind_count」欄，整批套用下列預設；若有對應欄則以<strong>各列</strong>
                  為準，同一批可混搭。
                </p>
                <div className="mt-3 grid gap-2 text-sm font-bold text-slate-900">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="stocktake-default-mode"
                      className="h-5 w-5 accent-amber-800"
                      checked={!stocktakeImportBlindDefault}
                      onChange={() => setStocktakeImportBlindDefault(false)}
                    />
                    核對（現場顯示帳面並預填數量）
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="stocktake-default-mode"
                      className="h-5 w-5 accent-amber-800"
                      checked={stocktakeImportBlindDefault}
                      onChange={() => setStocktakeImportBlindDefault(true)}
                    />
                    盲盤（現場隱藏帳面，輸入留空）
                  </label>
                </div>
              </div>
            )}
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setClassificationOpen(false);
                  setPendingPickImport(null);
                  setChosenImportOpType(null);
                  resetExcelFileInputs();
                }}
                className="min-h-[52px] rounded-xl bg-slate-200 font-black disabled:opacity-40"
              >
                取消
              </button>
              <button
                type="button"
                disabled={busy || chosenImportOpType === null}
                onClick={() =>
                  pendingPickImport && chosenImportOpType
                    ? void runPickingTasksImport(
                        chosenImportOpType,
                        pendingPickImport.sheet,
                        pendingPickImport.idxOrder,
                        pendingPickImport.idxItem,
                        pendingPickImport.idxQty,
                        pendingPickImport.idxTaskItemName,
                        pendingPickImport.idxBlindCount,
                        stocktakeImportBlindDefault,
                      )
                    : undefined
                }
                className="min-h-[52px] rounded-xl bg-blue-700 font-black text-white disabled:opacity-40"
              >
                {busy ? "匯入中…" : "確認並匯入"}
              </button>
            </div>
          </div>
        </div>
      )}

      {mapOpen && parsed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-2xl font-black">欄位對應：派單（picking_tasks）</h3>
            <p className="mt-2 text-sm font-semibold text-slate-600">
              請將 Excel 對應到派單欄位：單號會正規化成唯一鍵；同一直欄可空白沿用上一列；同單同料重複列會加總數量。
              盤點單可選對應「盤點模式」欄（1／Y／盲／核對等），未對應則於下一步選整批預設。
            </p>

            <div className="mt-4 grid gap-3">
              <label className="grid gap-2 font-black">
                order_no →
                <select
                  className="min-h-[52px] rounded-xl border border-slate-400 px-3 font-bold"
                  value={idxOrder}
                  onChange={(e) => setIdxOrder(Number(e.target.value))}
                >
                  <option value={-1}>
                    請選擇（若檔案中無獨立單號欄）
                  </option>
                  {colOpts.map((l, i) => (
                    <option key={`o-${l}-${i}`} value={i}>
                      [{i}] {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-2 font-black">
                item_no →
                <select
                  className="min-h-[52px] rounded-xl border border-slate-400 px-3 font-bold"
                  value={idxItem}
                  onChange={(e) => setIdxItem(Number(e.target.value))}
                >
                  <option value={-1}>請選擇</option>
                  {colOpts.map((l, i) => (
                    <option key={`m-${l}-${i}`} value={i}>
                      [{i}] {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-2 font-black">
                required_qty →
                <select
                  className="min-h-[52px] rounded-xl border border-slate-400 px-3 font-bold"
                  value={idxQty}
                  onChange={(e) => setIdxQty(Number(e.target.value))}
                >
                  <option value={-1}>請選擇</option>
                  {colOpts.map((l, i) => (
                    <option key={`q-${l}-${i}`} value={i}>
                      [{i}] {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-2 font-black">
                item_name →（選填；未選則以料號作為品名）
                <select
                  className="min-h-[52px] rounded-xl border border-slate-400 px-3 font-bold"
                  value={idxTaskItemName}
                  onChange={(e) =>
                    setIdxTaskItemName(Number(e.target.value))
                  }
                >
                  <option value={-1}>不從 Excel 讀取</option>
                  {colOpts.map((l, i) => (
                    <option key={`tin-${l}-${i}`} value={i}>
                      [{i}] {l}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-2 font-black">
                is_blind_count／盤點模式 →（選填；僅盤點單有效）
                <select
                  className="min-h-[52px] rounded-xl border border-slate-400 px-3 font-bold"
                  value={idxBlindCount}
                  onChange={(e) => setIdxBlindCount(Number(e.target.value))}
                >
                  <option value={-1}>不從 Excel 讀取（依匯入預設）</option>
                  {colOpts.map((l, i) => (
                    <option key={`bl-${l}-${i}`} value={i}>
                      [{i}] {l}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-xs font-semibold text-slate-500">
                確認後將選擇單據類型（入庫／檢貨／盤點）再寫入。
              </p>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setMapOpen(false);
                  setParsed(null);
                  setPendingFile(null);
                }}
                className="min-h-[60px] rounded-xl bg-slate-200 font-black text-slate-900"
              >
                取消
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void confirmMapping()}
                className="min-h-[60px] rounded-xl bg-blue-700 font-black text-white disabled:opacity-40"
              >
                {busy ? "匯入中…" : "確認匯入"}
              </button>
            </div>
            <p className="mt-2 text-xs font-semibold text-slate-400">
              檔名：{pendingFile?.name}
            </p>
          </div>
        </div>
      )}
    </main>
  );
}
