"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";

const ToastContext = createContext(null);

// Avisos flotantes breves. Confirman que una acción ha ocurrido, porque varias
// (cerrar sesión, guardar, marcar favorito) eran silenciosas y dejaban dudas
// sobre si habían funcionado.
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const counter = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message, kind = "info") => {
      counter.current += 1;
      const id = counter.current;
      setToasts((prev) => [...prev, { id, message, kind }]);
      setTimeout(() => dismiss(id), 3200);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <button key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismiss(t.id)}>
            {t.message}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  // Si algún componente se usa fuera del proveedor, no debe romper la app:
  // simplemente no muestra aviso.
  return ctx?.toast ?? (() => {});
}
