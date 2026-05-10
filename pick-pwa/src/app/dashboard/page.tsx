"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { MonitorDashboard } from "@/components/monitor/MonitorDashboard";
import { getSessionUser } from "@/lib/auth";

export default function DashboardMonitorPage() {
  const router = useRouter();

  useEffect(() => {
    if (!getSessionUser()) {
      router.replace("/");
    }
  }, [router]);

  return <MonitorDashboard />;
}
