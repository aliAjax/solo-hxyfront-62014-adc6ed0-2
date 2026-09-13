import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type ToastKind = "success" | "error" | "info";
export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

interface UiContextValue {
  toasts: Toast[];
  notify: (text: string, kind?: ToastKind) => void;
  dismiss: (id: number) => void;
}

const UiContext = createContext<UiContextValue | null>(null);

let toastSeq = 1;

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback(
    (text: string, kind: ToastKind = "info") => {
      const id = toastSeq++;
      setToasts((ts) => [...ts, { id, kind, text }]);
      setTimeout(() => dismiss(id), 3600);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toasts, notify, dismiss }), [toasts, notify, dismiss]);
  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi(): UiContextValue {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error("useUi 必须在 UiProvider 内使用");
  return ctx;
}
