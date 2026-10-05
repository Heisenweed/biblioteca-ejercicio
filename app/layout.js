import "./globals.css";
import { AuthProvider } from "../lib/AuthContext";
import { ToastProvider } from "../lib/ToastContext";
import ServiceWorkerRegister from "./ServiceWorkerRegister";

export const metadata = {
  title: "Biblioteca de ejercicios",
  description:
    "Biblioteca de ejercicios filtrable, artículos de valor y diseñador de sesiones para entrenar con criterio.",
  manifest: "/manifest.json",
  // Permite que el móvil la instale en la pantalla de inicio y la abra a
  // pantalla completa, sin la barra del navegador.
  appleWebApp: {
    capable: true,
    title: "Biblioteca",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport = {
  themeColor: "#14161a",
  width: "device-width",
  initialScale: 1,
  // Evita que la interfaz quede bajo la barra de estado o el notch cuando se
  // abre instalada a pantalla completa.
  viewportFit: "cover",
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ServiceWorkerRegister />
        <AuthProvider>
          <ToastProvider>{children}</ToastProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
