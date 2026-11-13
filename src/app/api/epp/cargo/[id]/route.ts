import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatDateTime, todayLima } from "@/lib/utils";
import { datosCargo, leerSeleccion } from "@/server/actas-epp";
import { cargoEntregaPdf, nombreArchivo } from "@/server/actas-epp-pdf";

export const dynamic = "force-dynamic";

/**
 * El cargo de entrega de EPP en PDF, para que el trabajador lo firme.
 *   ?lote=<id>       lo entregado de una sola vez
 *   ?fecha=aaaa-mm-dd  lo entregado ese día (entregas de antes de los lotes)
 *   (sin nada)       todo lo que tiene a su cargo hoy
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(user, "deliveries.view")) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });

  const { id } = await params;
  const sel = leerSeleccion(new URL(req.url));
  if (!sel) return NextResponse.json({ error: "Entrega inválida" }, { status: 400 });

  const datos = await datosCargo(id, sel, todayLima());
  if (!datos) return NextResponse.json({ error: "No hay entregas que poner en el cargo" }, { status: 404 });

  const pdf = cargoEntregaPdf(datos, `${formatDateTime(new Date())} por ${user.name}`);
  const nombre = nombreArchivo(datos.vigente ? "Cargo EPP vigente" : "Cargo de entrega EPP", datos.trabajador.nombre, datos.fecha);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nombre}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
