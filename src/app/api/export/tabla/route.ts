import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { todayLima } from "@/lib/utils";
import { toCsv, toPdf, toXlsx } from "@/server/exporters";
import { describeTableFilters, isTableKey, TABLE_EXPORTS } from "@/server/table-exports";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Descarga de cualquier tabla del sistema.
 *
 * Toma los mismos parámetros que la pantalla de la que sale, así que lo que se baja es lo
 * que se está viendo, con sus filtros aplicados. Cada tabla exige el permiso de su módulo:
 * la encargada de detracciones puede bajarse su lista, pero no la de trabajadores.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const tabla = sp.tabla;
  if (!isTableKey(tabla)) return NextResponse.json({ error: "Tabla desconocida" }, { status: 400 });

  const definicion = TABLE_EXPORTS[tabla];
  if (!can(user.role, definicion.permission)) {
    return NextResponse.json({ error: "Sin permiso para exportar esta tabla" }, { status: 403 });
  }

  const formato = sp.format ?? "xlsx";
  const reports = await definicion.build(sp);
  const filtros = describeTableFilters(sp);
  const nombre = `transjer-${tabla}-${todayLima()}`;

  if (formato === "xlsx") {
    const body = await toXlsx(reports, filtros, user.name);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${nombre}.xlsx"`,
      },
    });
  }
  if (formato === "csv") {
    return new NextResponse(toCsv(reports), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${nombre}.csv"` },
    });
  }
  if (formato === "pdf") {
    const body = toPdf(reports, filtros, user.name);
    return new NextResponse(new Uint8Array(body), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${nombre}.pdf"` },
    });
  }
  return NextResponse.json({ error: "Formato inválido" }, { status: 400 });
}
