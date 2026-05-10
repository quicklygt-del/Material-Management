-- 單一企業全域總帳：確保 warehouse_ledger_stock 具備 item_no，避免 API 出現
-- column "item_no" does not exist（請於 Supabase SQL Editor 執行一次）

DO $$
BEGIN
  IF to_regclass('public.warehouse_ledger_stock') IS NULL THEN
    RAISE NOTICE '略過：public.warehouse_ledger_stock 不存在';
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'warehouse_ledger_stock'
      AND column_name = 'item_no'
  ) THEN
    ALTER TABLE public.warehouse_ledger_stock ADD COLUMN item_no text;
    RAISE NOTICE '已新增欄位 warehouse_ledger_stock.item_no';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'warehouse_ledger_stock'
      AND column_name = 'item_no'
  ) THEN
    UPDATE public.warehouse_ledger_stock
    SET item_no = trim(item_no)
    WHERE (item_no IS NULL OR trim(item_no) = '')
      AND item_no IS NOT NULL
      AND trim(item_no) <> '';
  END IF;
END $$;
