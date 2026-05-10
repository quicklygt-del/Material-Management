-- 單租戶修補：若已自資料表刪除 _id，但觸發器／RLS／檢視仍引用該欄，
-- 會出現 "column warehouse_ledger_stock._id does not exist"。
-- 於 Supabase SQL Editor（具足夠權限）執行；執行前請自行備份。

-- 僅刪除名稱疑似與租戶相關的觸發器（避免誤刪 updated_at 等通用觸發器）
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT t.tgname
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'warehouse_ledger_stock'
      AND NOT t.tgisinternal
      AND (
        t.tgname ILIKE '%%'
        OR t.tgname ILIKE '%company%'
        OR t.tgname ILIKE '%rls%'
      )
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.warehouse_ledger_stock', r.tgname);
  END LOOP;

  FOR r IN
    SELECT t.tgname
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'warehouse_ledger_lines'
      AND NOT t.tgisinternal
      AND (
        t.tgname ILIKE '%%'
        OR t.tgname ILIKE '%company%'
        OR t.tgname ILIKE '%rls%'
      )
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.warehouse_ledger_lines', r.tgname);
  END LOOP;
END $$;

-- DROP/CREATE POLICY 的 ON 子句在「表不存在」時仍會報錯，必須先判斷表是否存在。
DO $$
BEGIN
  IF to_regclass('public.warehouse_ledger_stock') IS NOT NULL THEN
    ALTER TABLE public.warehouse_ledger_stock ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS warehouse_ledger_stock_all ON public.warehouse_ledger_stock;
    CREATE POLICY warehouse_ledger_stock_all ON public.warehouse_ledger_stock
      FOR ALL USING (true) WITH CHECK (true);
    ALTER TABLE public.warehouse_ledger_stock
      DROP COLUMN IF EXISTS _id CASCADE;
  ELSE
    RAISE NOTICE '略過：public.warehouse_ledger_stock 不存在';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.warehouse_ledger_lines') IS NOT NULL THEN
    ALTER TABLE public.warehouse_ledger_lines ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS warehouse_ledger_lines_all ON public.warehouse_ledger_lines;
    CREATE POLICY warehouse_ledger_lines_all ON public.warehouse_ledger_lines
      FOR ALL USING (true) WITH CHECK (true);
    ALTER TABLE public.warehouse_ledger_lines
      DROP COLUMN IF EXISTS _id CASCADE;
  ELSE
    RAISE NOTICE '略過：public.warehouse_ledger_lines 不存在（若未部署倉儲異動日誌表屬正常）';
  END IF;
END $$;
