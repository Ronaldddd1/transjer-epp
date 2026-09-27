import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Identidad de Transjer.
 *
 * Los archivos son los oficiales de la empresa y viven en /public:
 *   logo.png         Logotipo completo, para fondo claro.
 *   logo-blanco.png  El mismo, con el texto en blanco, para fondo oscuro.
 *   logo-tj.png      Solo el monograma TJ, para espacios reducidos.
 */

const LOGO = { ancho: 246, alto: 223 };
const MONOGRAMA = { ancho: 107, alto: 223 };

/** Logotipo completo. `inverted` para fondos oscuros. */
export function TransjerLogo({ width = 160, inverted = false, className, priority = false }: {
  width?: number; inverted?: boolean; className?: string; priority?: boolean;
}) {
  return (
    <Image
      src={inverted ? "/logo-blanco.png" : "/logo.png"}
      alt="Transjer Operador Logístico"
      width={LOGO.ancho}
      height={LOGO.alto}
      priority={priority}
      className={cn("h-auto", className)}
      style={{ width }}
    />
  );
}

/** Monograma TJ, para cabeceras estrechas. */
export function BrandMark({ height = 32, className }: { height?: number; className?: string }) {
  return (
    <Image
      src="/logo-tj.png"
      alt=""
      aria-hidden
      width={MONOGRAMA.ancho}
      height={MONOGRAMA.alto}
      className={cn("w-auto", className)}
      style={{ height }}
    />
  );
}

/** Marca del menú lateral. */
export function BrandLockup() {
  return (
    <div>
      <TransjerLogo width={128} inverted />
      <p className="mt-2.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-steel-500">
        Sistema de gestión
      </p>
    </div>
  );
}
