import { createContext, useContext, useState, type ReactNode } from "react";

export type ToastType = "info" | "success" | "error";

interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  showToast: (type: ToastType, message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let toastId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  function showToast(type: ToastType, message: string) {
    const id = ++toastId;
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div style={{
        position: "fixed", bottom: 20, right: 20, zIndex: 9999,
        display: "flex", flexDirection: "column", gap: 8,
      }}>
        {toasts.map(toast => (
          <div key={toast.id} style={{
            padding: "12px 16px", borderRadius: 8, minWidth: 280,
            background: toast.type === "error" ? "#7F1D1D" : toast.type === "success" ? "#14532D" : "#1E3A5F",
            color: "#fff", fontSize: 13, fontWeight: 500, boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          }}>
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}