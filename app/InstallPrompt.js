"use client";

import { useEffect, useState } from "react";

const DISMISS_KEY = "install-prompt-dismissed";

// Aviso para instalar la aplicación en la pantalla de inicio.
//
// Android y escritorio permiten lanzar el diálogo nativo del navegador, así que
// ahí basta con un botón. iOS no ofrece ninguna API para esto: Apple obliga a
// hacerlo a mano desde el menú de compartir, así que lo único que podemos hacer
// es explicar el gesto con claridad. De ahí que haya dos variantes.
export default function InstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [platform, setPlatform] = useState(null); // 'ios' | 'prompt'
  const [deferredEvent, setDeferredEvent] = useState(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Si ya está instalada y se está abriendo desde el icono, no molestamos.
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      window.navigator.standalone === true;
    if (standalone) return;

    // Respetamos que ya la hayan descartado antes.
    try {
      if (localStorage.getItem(DISMISS_KEY) === "1") return;
    } catch (e) {
      // Si el almacenamiento está bloqueado, seguimos: solo significa que el
      // aviso podría reaparecer en otra visita.
    }

    const ua = window.navigator.userAgent || "";
    const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
    const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);

    if (isIOS) {
      // En iOS solo tiene sentido en Safari: desde Chrome o Firefox para iOS
      // no se puede añadir a la pantalla de inicio.
      if (!isSafari) return;
      setPlatform("ios");
      const t = setTimeout(() => setVisible(true), 4000);
      return () => clearTimeout(t);
    }

    // Resto de navegadores: esperamos a que el navegador nos avise de que la
    // app cumple los requisitos para instalarse.
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredEvent(e);
      setPlatform("prompt");
      setVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch (e) {
      // Sin almacenamiento disponible: se oculta igual durante esta visita.
    }
  }

  async function install() {
    if (!deferredEvent) return;
    deferredEvent.prompt();
    try {
      await deferredEvent.userChoice;
    } catch (e) {
      // La persona puede cerrar el diálogo del navegador; no es un error.
    }
    setDeferredEvent(null);
    dismiss();
  }

  if (!visible) return null;

  return (
    <div className="install-prompt">
      <div className="install-prompt-inner">
        <div className="install-prompt-text">
          <strong>Instala la app en tu móvil</strong>
          {platform === "ios" ? (
            <span>
              Pulsa el botón de compartir <span className="ios-share-icon">⬆︎</span> en la barra de Safari y
              elige <strong>“Añadir a pantalla de inicio”</strong>. Se abrirá como una app, sin barra de
              navegador.
            </span>
          ) : (
            <span>
              Instálala en tu pantalla de inicio y ábrela como una app, sin barra de navegador. No ocupa casi
              nada.
            </span>
          )}
        </div>
        <div className="install-prompt-actions">
          {platform === "prompt" && (
            <button className="account-btn account-btn-primary" onClick={install}>
              Instalar app
            </button>
          )}
          <button className="install-prompt-dismiss" onClick={dismiss}>
            {platform === "ios" ? "Entendido" : "Ahora no"}
          </button>
        </div>
      </div>
    </div>
  );
}
