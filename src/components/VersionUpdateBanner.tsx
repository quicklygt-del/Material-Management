"use client";

import { useEffect, useState } from "react";
import { APP_VERSION } from "@/lib/version";

type VersionPayload = {
  version?: unknown;
};

const CHECK_MS = 30_000;

async function getRemoteVersion(): Promise<string | null> {
  try {
    const r = await fetch(`/api/version?t=${Date.now()}`, {
      cache: "no-store",
      headers: { "cache-control": "no-cache" },
    });
    if (!r.ok) return null;
    const data = (await r.json()) as VersionPayload;
    const v = String(data.version ?? "").trim();
    return v || null;
  } catch {
    return null;
  }
}

async function hardRefresh() {
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } finally {
    window.location.reload();
  }
}

export default function VersionUpdateBanner() {
  const [nextVersion, setNextVersion] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    const check = async () => {
      const remote = await getRemoteVersion();
      if (!alive || !remote || remote === APP_VERSION) return;
      setNextVersion(remote);
    };

    void check();
    const timer = window.setInterval(() => {
      void check();
    }, CHECK_MS);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  if (!nextVersion) return null;

  return (
    <div className="fixed inset-x-0 bottom-4 z-50 mx-auto w-[min(680px,calc(100%-1rem))] rounded-xl border border-amber-300 bg-amber-100 p-3 shadow-lg">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm font-black text-amber-900">
          偵測到新版本：{nextVersion}（目前 {APP_VERSION}）
        </p>
        <button
          onClick={() => void hardRefresh()}
          className="h-10 rounded-lg bg-amber-500 px-4 text-sm font-black text-white"
        >
          立即更新
        </button>
      </div>
    </div>
  );
}
