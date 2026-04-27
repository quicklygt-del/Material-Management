'use client';

import { useSupabaseClient } from '@supabase/auth-helpers-react';
import { useState } from 'react';

export default function TransactionsPage() {
  const supabase = useSupabaseClient();
  const [materialCode, setMaterialCode] = useState('');
  const [type, setType] = useState<'in' | 'out' | 'count'>('in');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState<'base' | 'pack'>('base');

  const handleSubmit = async () => {
    if (!materialCode || !quantity) return alert('請填寫物料編號與數量');
    const qtyNum = parseFloat(quantity);
    // 取得物料資訊
    const { data: mat } = await supabase.from('materials').select('*').eq('code', materialCode).single();
    if (!mat) return alert('物料不存在');
    let baseQty = unit === 'base' ? qtyNum : qtyNum * mat.pack_ratio;
    // 取得目前庫存
    const { data: inv } = await supabase.from('inventory').select('quantity').eq('material_code', materialCode).single();
    const before = inv?.quantity || 0;
    let after = before;
    if (type === 'in') after = before + baseQty;
    if (type === 'out') after = before - baseQty;
    if (type === 'count') after = baseQty;
    if (type === 'out' && after < 0) return alert('庫存不足');
    // 更新庫存
    const { error: upsertErr } = await supabase.from('inventory').upsert({ material_code: materialCode, quantity: after });
    if (upsertErr) return alert(upsertErr.message);
    // 記錄交易
    const { error: logErr } = await supabase.from('transactions').insert({
      material_code: materialCode,
      type,
      unit: unit === 'base' ? mat.base_unit : mat.pack_unit,
      qty: qtyNum,
      base_qty: baseQty,
      before_base_qty: before,
      after_base_qty: after,
    });
    if (logErr) console.error(logErr);
    alert(`${type==='in'?'入庫':type==='out'?'出庫':'盤點'}成功，新庫存：${after} ${mat.base_unit}`);
    setMaterialCode('');
    setQuantity('');
  };

  return (
    <div className="p-6 max-w-xl">
      <h1 className="text-2xl font-bold mb-4">出入庫／盤點</h1>
      <input className="border p-2 w-full mb-2" placeholder="物料編號" value={materialCode} onChange={e=>setMaterialCode(e.target.value)} />
      <select className="border p-2 w-full mb-2" value={type} onChange={e=>setType(e.target.value as any)}>
        <option value="in">入庫</option><option value="out">出庫</option><option value="count">盤點</option>
      </select>
      <div className="flex gap-2 mb-2">
        <input className="border p-2 flex-1" type="number" placeholder="數量" value={quantity} onChange={e=>setQuantity(e.target.value)} />
        <select className="border p-2" value={unit} onChange={e=>setUnit(e.target.value as any)}>
          <option value="base">基本單位</option><option value="pack">包裝單位</option>
        </select>
      </div>
      <button className="bg-blue-600 text-white px-4 py-2 rounded" onClick={handleSubmit}>確認</button>
    </div>
  );
}
