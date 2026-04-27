'use client';

import { useSession, useSupabaseClient } from '@supabase/auth-helpers-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function Dashboard() {
  const session = useSession();
  const supabase = useSupabaseClient();
  const router = useRouter();
  const [totalMaterials, setTotalMaterials] = useState(0);
  const [totalInventory, setTotalInventory] = useState(0);

  useEffect(() => {
    if (!session) router.push('/');
    else fetchStats();
  }, [session, router]);

  async function fetchStats() {
    const { count: matCount } = await supabase.from('materials').select('*', { count: 'exact', head: true });
    const { data: invData } = await supabase.from('inventory').select('quantity');
    const totalQty = invData?.reduce((sum, i) => sum + (i.quantity || 0), 0) || 0;
    setTotalMaterials(matCount || 0);
    setTotalInventory(totalQty);
  }

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/');
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow">
        <div className="mx-auto max-w-7xl px-4 py-3 flex justify-between">
          <h1 className="text-xl font-bold">物料管理後台</h1>
          <button onClick={handleLogout} className="text-red-600">登出</button>
        </div>
      </nav>
      <div className="mx-auto max-w-7xl p-6">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Link href="/dashboard/materials" className="rounded-lg bg-white p-6 shadow hover:shadow-lg">
            <h2 className="text-lg font-semibold">物料管理</h2>
            <p className="text-2xl">{totalMaterials}</p>
            <p className="text-sm text-gray-500">匯入／匯出物料</p>
          </Link>
          <Link href="/dashboard/inventory" className="rounded-lg bg-white p-6 shadow hover:shadow-lg">
            <h2 className="text-lg font-semibold">庫存查詢</h2>
            <p className="text-2xl">{totalInventory}</p>
            <p className="text-sm text-gray-500">目前總庫存量</p>
          </Link>
          <Link href="/dashboard/transactions" className="rounded-lg bg-white p-6 shadow hover:shadow-lg">
            <h2 className="text-lg font-semibold">出入庫／盤點</h2>
            <p className="text-sm text-gray-500">手動操作或檢視紀錄</p>
          </Link>
          <Link href="/dashboard/orders" className="rounded-lg bg-white p-6 shadow hover:shadow-lg">
            <h2 className="text-lg font-semibold">領料單</h2>
            <p className="text-sm text-gray-500">建立並執行領料</p>
          </Link>
          <Link href="/dashboard/export" className="rounded-lg bg-white p-6 shadow hover:shadow-lg">
            <h2 className="text-lg font-semibold">匯出報表</h2>
            <p className="text-sm text-gray-500">Excel 拋轉 ERP</p>
          </Link>
        </div>
      </div>
    </div>
  );
}
