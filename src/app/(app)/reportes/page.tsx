import { redirect } from "next/navigation";

/**
 * Reportes y exportación salió del menú: cada pantalla tiene su propio botón Descargar,
 * con los filtros que se están mirando. Quien llegue por un enlace viejo va al inicio.
 */
export default function ReportsPage() {
  redirect("/dashboard");
}
