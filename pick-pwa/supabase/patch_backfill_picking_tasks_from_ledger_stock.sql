-- 一次性修補：依料號從 warehouse_ledger_stock 補回 picking_tasks 的 item_name / spec
-- 僅在任務列為 NULL 或空白字串時覆寫；需與總帳列 tenant_id、item_no 一致。
-- 請先執行 patch_picking_tasks_item_name_unit.sql（含 item_name、unit、spec）。

DO $$
BEGIN
  IF to_regclass('public.warehouse_ledger_stock') IS NULL THEN
    RAISE NOTICE 'warehouse_ledger_stock 不存在，略過補檔';
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'picking_tasks' AND column_name = 'item_code'
  ) THEN
    EXECUTE $SQL$
      UPDATE public.picking_tasks pt
      SET
        item_name = COALESCE(NULLIF(BTRIM(pt.item_name), ''), NULLIF(BTRIM(wls.item_name), '')),
        spec = COALESCE(NULLIF(BTRIM(pt.spec), ''), NULLIF(BTRIM(wls.spec), ''))
      FROM public.warehouse_ledger_stock wls
      WHERE pt.tenant_id = wls.tenant_id
        AND lower(btrim(pt.item_code)) = lower(btrim(wls.item_no))
        AND (pt.item_name IS NULL OR btrim(pt.item_name) = '');
    $SQL$;
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'picking_tasks' AND column_name = 'item_no'
  ) THEN
    EXECUTE $SQL$
      UPDATE public.picking_tasks pt
      SET
        item_name = COALESCE(NULLIF(BTRIM(pt.item_name), ''), NULLIF(BTRIM(wls.item_name), '')),
        spec = COALESCE(NULLIF(BTRIM(pt.spec), ''), NULLIF(BTRIM(wls.spec), ''))
      FROM public.warehouse_ledger_stock wls
      WHERE pt.tenant_id = wls.tenant_id
        AND lower(btrim(pt.item_no)) = lower(btrim(wls.item_no))
        AND (pt.item_name IS NULL OR btrim(pt.item_name) = '');
    $SQL$;
  END IF;
END $$;
