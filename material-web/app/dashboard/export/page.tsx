'use client';

import { useSupabaseClient } from '@supabase/auth-helpers-react';
import * as XLSX from 'xlsx';

export default function ExportPage() {
  const supabase = useSupabaseClient();

  const exportTransactions = async () => {
    const { data } = await supabase.from('transactions').select('*, materials(name)').order('created_at', { ascending: false });
    if (!data) return;
    const ws = XLSX.utils.json_to_sheet(data.map(t => ({
      時間: t.created_at, 物料編號: t.material_code, 物料名稱: t.materials?.name,
      類型: t.type, 單位: t.unit, 數量: t.qty, 基本數量: t.base_qty,
      異動前: t.before_base_qty, 異動後: t.after_base_qty
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '交易紀錄');
    XLSX.writeFile(wb, `transactions_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">匯出報表</h1>
      <button onClick={exportTransactions} className="bg-green-600 text-white px-4 py-2 rounded">匯出全部交易 Excel</button>
    </div>
  );
}
