"use client";

import { ImageDown, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Guarda una parte de la pantalla como imagen PNG.
 *
 * Es para mandar algo por WhatsApp tal como se ve —el calendario de pagos del mes, por
 * ejemplo— sin recortar capturas de pantalla. La imagen se arma en el navegador: no pasa
 * por el servidor.
 *
 * Lo que no deba salir en la imagen (flechas para cambiar de mes, enlaces de navegación)
 * se marca con `data-sin-captura`.
 */
export function DownloadImageButton({ targetId, filename, label = "Descargar imagen", anchoMinimo = 1120 }: {
  /** El id del elemento que se fotografía. */
  targetId: string;
  filename: string;
  label?: string;
  /** Ancho mínimo de la imagen, en píxeles de pantalla. */
  anchoMinimo?: number;
}) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function descargar() {
    const el = document.getElementById(targetId);
    if (!el) return;
    setOcupado(true);
    setError(null);

    // La imagen sale siempre con el ancho de una pantalla de escritorio, se descargue desde
    // donde se descargue. En el celular la tabla vive en un contenedor con scroll y la
    // cabecera tiene el ancho del teléfono: la foto salía cortada, o descuadrada. Mientras
    // se toma, el bloque se ensancha y los contenedores con scroll se abren.
    const scrolls = Array.from(el.querySelectorAll<HTMLElement>(".overflow-x-auto"));
    const antes = scrolls.map((s) => s.style.overflow);
    const anchoAntes = el.style.width;
    el.style.width = `${Math.max(anchoMinimo, el.offsetWidth)}px`;
    scrolls.forEach((s) => { s.style.overflow = "visible"; });
    const ancho = Math.max(el.scrollWidth, ...scrolls.map((s) => s.scrollWidth));

    try {
      const { toPng } = await import("html-to-image");
      const opciones = {
        pixelRatio: 2,
        backgroundColor: "#ffffff",
        width: ancho,
        style: { width: `${ancho}px`, margin: "0" },
        filter: (n: HTMLElement) => !(n.dataset && "sinCaptura" in n.dataset),
      };
      let url: string;
      try {
        url = await toPng(el, opciones);
      } catch {
        // Si no consigue incrustar las fuentes, sale con las del sistema antes que nada.
        url = await toPng(el, { ...opciones, skipFonts: true });
      }
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      setError("No se pudo armar la imagen. Prueba de nuevo.");
    } finally {
      scrolls.forEach((s, i) => { s.style.overflow = antes[i]; });
      el.style.width = anchoAntes;
      setOcupado(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end">
      <Button variant="outline" onClick={descargar} disabled={ocupado}>
        {ocupado ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ImageDown className="h-4 w-4" aria-hidden />}
        {ocupado ? "Armando la imagen…" : label}
      </Button>
      {error && <span role="alert" className="mt-1 text-xs text-red-700">{error}</span>}
    </span>
  );
}
