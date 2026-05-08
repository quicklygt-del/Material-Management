"use client";

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { getDefaultLabelPrefix } from "@/lib/labelEncoding";

/** 單一公司模式：一律使用環境變數預設前綴（與 QR／DB  對齊） */
type Ctx = {
  tenantId: string;
  /** 保留呼叫端相容；已不會改變公司識別 */
  setTenantId: (_raw: string) => void;
};

const QrTenantContext = createContext<Ctx | null>(null);

export function QrCenterTenantProvider({ children }: { children: ReactNode }) {
  const value = useMemo(
    () => ({
      tenantId: getDefaultLabelPrefix(),
      setTenantId: () => {
        void 0;
      },
    }),
    [],
  );

  return (
    <QrTenantContext.Provider value={value}>{children}</QrTenantContext.Provider>
  );
}

export function useQrCenterTenant(): Ctx {
  const c = useContext(QrTenantContext);
  if (!c) {
    throw new Error("useQrCenterTenant 需在 QrCenterTenantProvider 內使用");
  }
  return c;
}
