import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "AI 智能 QR 管理系統",
};

export default function OperateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
