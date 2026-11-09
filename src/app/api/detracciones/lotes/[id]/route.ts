import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { archivoDeLote } from "@/server/detraction-batches";

export const dynamic = "force-dynamic";

/**
 * El archivo TXT de un lote para "Depósitos Masivos" de SUNAT. Se puede volver a bajar
 * cuantas veces haga falta: sale siempre igual, con las cuentas que tienen hoy los
 * proveedores.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(user, "detractions.view")) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Lote inválido" }, { status: 400 });

  try {
    const archivo = await archivoDeLote(id);
    if (!archivo) return NextResponse.json({ error: "El lote no existe" }, { status: 404 });
    return new NextResponse(archivo.contenido, {
      headers: {
        "Content-Type": "text/plain; charset=us-ascii",
        "Content-Disposition": `attachment; filename="${archivo.nombre}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    // Un proveedor al que le borraron la cuenta después de armar el lote, por ejemplo.
    const motivo = error instanceof Error ? error.message : "No se pudo armar el archivo";
    return NextResponse.json({ error: motivo }, { status: 422 });
  }
}
