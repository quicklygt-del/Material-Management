import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import VersionUpdateBanner from "@/components/VersionUpdateBanner";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "AI 智能 QR 管理系統",
  description:
    "現場 QR 管理中心：標籤印製、快速辨識與資產異動；管理端整合報表與虛擬倉庫。",
  applicationName: "AI 智能 QR 管理系統",
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <VersionUpdateBanner />
      </body>
    </html>
  );
}
