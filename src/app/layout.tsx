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
  title: { default: "Transjer Gestión", template: "%s · Transjer Gestión" },
  description: "Sistema de gestión de Transjer Operador Logístico S.A.C.: almacén de EPP y facturas de proveedores.",
  icons: { icon: "/icon.png", apple: "/icon.png" },
};

export const viewport: Viewport = { themeColor: "#000000", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: algunas extensiones del navegador (ColorZilla, gestores de
    // contraseñas, traductores) agregan atributos al <html> y al <body> antes de que React
    // cargue. Sin esto, el modo de desarrollo avisa de una diferencia que no es del sistema.
    // Solo afecta a los atributos de esas dos etiquetas; el contenido se sigue verificando.
    <html lang="es-PE" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
