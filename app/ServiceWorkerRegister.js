"use client";

import { useEffect } from "react";

// Registra el service worker en segundo plano. Si falla (navegador antiguo,
// conexión insegura, etc.) no pasa nada: la aplicación sigue funcionando
// exactamente igual, solo que el navegador no ofrecerá instalarla.
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Silencioso a propósito: no es un error que deba molestar a nadie.
      });
    };

    // Se espera a que la página haya cargado para no competir por ancho de
    // banda con los datos que la persona sí necesita ver.
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
