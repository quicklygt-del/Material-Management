"use client";

import {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { getDefaultLabelPrefix } from "@/lib/labelEncoding";

type Ctx = {
  labelPrefix: string;
  setLabelPrefix: (_raw: string) => void;
};

const QrLabelContext = createContext<Ctx | null>(null);

export function QrCenterLabelProvider({ children }: { children: ReactNode }) {
  const value = useMemo(
    () => ({
      labelPrefix: getDefaultLabelPrefix(),
      setLabelPrefix: () => {
        void 0;
      },
    }),
    [],
  );

  return (
    <QrLabelContext.Provider value={value}>{children}</QrLabelContext.Provider>
  );
}

export function useQrCenterLabel(): Ctx {
  const c = useContext(QrLabelContext);
  if (!c) {
    throw new Error("useQrCenterLabel 需在 QrCenterLabelProvider 內使用");
  }
  return c;
}
