import { redirect } from "next/navigation";

/**
 * La flota ya es la pantalla principal de documentos.
 *
 * Esta dirección se queda como reenvío porque está en enlaces guardados y en correos de
 * avisos anteriores: romperla no aportaría nada.
 */
export default function VehiculosPage() {
  redirect("/documentos");
}
