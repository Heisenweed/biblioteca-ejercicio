// Service worker mínimo.
//
// Su única función hoy es cumplir el requisito que imponen los navegadores para
// ofrecer la opción de "instalar" la aplicación. Deliberadamente NO guarda nada
// en caché: hacerlo mal provocaría que la gente siguiera viendo una versión
// antigua de la app después de cada despliegue, que es el fallo más común al
// montar esto. El funcionamiento sin conexión es un paso posterior y requiere
// una estrategia de caché pensada con cuidado.

self.addEventListener("install", () => {
  // Activa esta versión sin esperar a que se cierren las pestañas antiguas.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Toma el control de las pestañas ya abiertas y limpia cachés de versiones
  // anteriores, por si en el futuro se añade alguna.
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

// Sin interceptar peticiones: todo va directo a la red, como hasta ahora.
