'use client';

import { useSupabaseClient } from '@supabase/auth-helpers-react';
import { useEffect, useState } from 'react';
import * as XLSX from 'xlsx';

interface Material {
  code: string;
  name: string;
  base_unit: string;
  pack_unit: string | null;
  pack_ratio: number;
  price: number | null;
}

export default function MaterialsPage() {
  const supabase = useSupabaseClient();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMaterials();
  }, []);

  async function fetchMaterials() {
    setLoading(true);
    const { data, error } = await supabase.from('materials').select('*').order('code');
    if (error) alert(error.message);
    else setMaterials(data || []);
    setLoading(false);
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet);
    // 預期欄位：code, name, base_unit, pack_unit, pack_ratio, price
    for (const row of rows) {
      const { error } = await supabase.from('materials').upsert({
        code: row.code,
        name: row.name,
        base_unit: row.base_unit,
        pack_unit: row.pack_unit || null,
        pack_ratio: row.pack_ratio || 1,
        price: row.price || null,
      });
      if (error) console.error(error);
    }
    alert('匯入完成');
    fetchMaterials();
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">物料管理</h1>
      <div className="mb-4">
        <label className="bg-blue-600 text-white px-4 py-2 rounded cursor-pointer">
          從 Excel 匯入物料
          <input type="file" accept=".xlsx, .xls, .csv" onChange={handleFileUpload} className="hidden" />
        </label>
      </div>
      {loading ? (
        <p>載入中…</p>
      ) : (
        <table className="min-w-full bg-white border">
          <thead>
            <tr>
              <th className="border p-2">物料編號</th><th>名稱</th><th>基本單位</th><th>包裝單位</th><th>換算率</th>
            </tr>
          </thead>
          <tbody>
            {materials.map((m) => (
              <tr key={m.code}>
                <td className="border p-2">{m.code}</td><td className="border p-2">{m.name}</td>
                <td className="border p-2">{m.base_unit}</td>
                <td className="border p-2">{m.pack_unit || '-'}</td>
                <td className="border p-2">{m.pack_ratio}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
