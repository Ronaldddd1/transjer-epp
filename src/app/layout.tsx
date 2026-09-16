import type { Metadata, Viewport } from "next";
import { ToastProvider } from "@/components/ui/toast";
// Tipografías autoalojadas (solo el subconjunto latino: español con tildes y ñ)
import "@fontsource/barlow/latin-400.css";
import "@fontsource/barlow/latin-500.css";
import "@fontsource/barlow/latin-600.css";
import "@fontsource/barlow/latin-700.css";
import "@fontsource/barlow-semi-condensed/latin-500.css";
import "@fontsource/barlow-semi-condensed/latin-600.css";
import "@fontsource/barlow-semi-condensed/latin-700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Control de Inventario de EPP — Transjer", template: "%s · EPP Transjer" },
  description: "Sistema de control de Equipos de Protección Personal de Transjer Operador Logístico S.A.C.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { themeColor: "#000000", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-PE">
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
