"use client";

import React from "react";
/** 
 * 顧問備註：
 * 暫時註解掉 SupervisorOnlyGate 以解除「驗證權限中」的無限跳轉循環。
 * 等到資料庫與登入狀態同步後，再考慮將其接回。
 */
// import { SupervisorOnlyGate } from "@/components/auth/SupervisorOnlyGate";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="admin-layout-wrapper" style={{ minHeight: "100vh" }}>
      {/* 
          核心變更：直接回傳 children，跳過權限檢查。
          這將允許您繞過登入驗證，直接存取 http://localhost:3000/admin 
      */}
      <main>
        {children}
      </main>
    </div>
  );
}