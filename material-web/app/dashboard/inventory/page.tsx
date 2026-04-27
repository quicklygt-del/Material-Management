'use client';

import { useSupabaseClient } from '@supabase/auth-helpers-react';
import { useEffect, useState } from 'react';

export default function InventoryPage() {
  const supabase = useSupabaseClient();
  const [inventory, setInventory] = useState<any[]>([]);

  useEffect(() => {
    fetchInventory();
  }, []);

  async function fetchInventory() {
    const { data, error } = await supabase
      .from('inventory')
      .select(`material_code, quantity, materials (code, name, base_unit, pack_unit, pack_ratio)`);
    if (error) alert(error.message);
    else setInventory(data || []);
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">庫存查詢</h1>
      <table className="min-w-full bg-white border">
        <thead><tr><th>物料編號</th><th>名稱</th><th>基本單位</th><th>庫存數量</th><th>折合包裝</th></tr></thead>
        <tbody>
          {inventory.map((item) => {
            const mat = item.materials;
            const packQty = mat?.pack_ratio ? Math.floor(item.quantity / mat.pack_ratio) : 0;
            return (
              <tr key={item.material_code}>
                <td className="border p-2">{mat?.code}</td>
                <td className="border p-2">{mat?.name}</td>
                <td className="border p-2">{mat?.base_unit}</td>
                <td className="border p-2">{item.quantity}</td>
                <td className="border p-2">{packQty} {mat?.pack_unit || ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
