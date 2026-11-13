import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatDateTime } from "@/lib/utils";
import { datosDevolucion, leerSeleccion } from "@/server/actas-epp";
import { actaDevolucionPdf, esCompleta, nombreArchivo } from "@/server/actas-epp-pdf";

export const dynamic = "force-dynamic";

/**
 * El acta de devolución de EPP en PDF: lo que entrega, en qué estado, y si con eso la
 * devolución es completa o parcial.
 *   ?lote=<id>         lo devuelto de una sola vez
 *   ?fecha=aaaa-mm-dd  lo devuelto ese día (devoluciones de antes de los lotes)
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(user, "deliveries.view")) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });

  const { id } = await params;
  const sel = leerSeleccion(new URL(req.url));
  if (!sel || (!sel.lote && !sel.fecha)) return NextResponse.json({ error: "Devolución inválida" }, { status: 400 });

  const datos = await datosDevolucion(id, sel);
  if (!datos) return NextResponse.json({ error: "No se encontró esa devolución" }, { status: 404 });

  const pdf = actaDevolucionPdf(datos, `${formatDateTime(new Date())} por ${user.name}`);
  const tipo = esCompleta(datos) ? "Acta devolucion EPP completa" : "Acta devolucion EPP parcial";
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nombreArchivo(tipo, datos.trabajador.nombre, datos.fecha)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
