import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatDate } from "@/lib/utils";
import { lugares, obtenerPlan } from "@/server/rutas";

export const dynamic = "force-dynamic";

/**
 * Las hojas de ruta en Excel: una pestaña por móvil, con las entregas en el orden en que
 * se visitan y lo que necesita el conductor (teléfono, referencia, pedidos, peso).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(user, "trips.view")) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  const { id } = await params;
  const datos = await obtenerPlan(id);
  if (!datos) return NextResponse.json({ error: "No existe" }, { status: 404 });
  const { plan, moviles, paradas } = datos;
  const { centro } = await lugares();

  const wb = new ExcelJS.Workbook();
  wb.creator = "Transjer Gestión";
  const conRuta = moviles.filter((m) => m.km != null);
  const negrita = { bold: true, name: "Arial", size: 10 } as const;

  // Resumen.
  const res = wb.addWorksheet("Resumen");
  res.columns = [{ width: 14 }, { width: 10 }, { width: 10 }, { width: 12 }, { width: 12 }, { width: 12 }];
  res.addRow([`Reparto del ${formatDate(plan.serviceDate)}`]).font = { ...negrita, size: 13 };
  res.addRow([`Cochera → carga en ${centro.name} → entregas → cochera${plan.approximate ? " · km aproximados (línea recta)" : ""}`]).font = { name: "Arial", size: 10, italic: true };
  res.addRow([]);
  const cab = res.addRow(["Móvil", "Paradas", "Km", "Tiempo (min)", "Carga (kg)", "Carga (m³)"]);
  cab.font = negrita;
  cab.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFC20E" } }; });
  for (const m of conRuta) {
    res.addRow([m.plate, paradas.filter((p) => p.planVehicleId === m.id).length, Number(m.km), m.minutes, Number(m.loadKg), Number(m.loadM3)]);
  }
  const total = res.addRow(["Total", paradas.filter((p) => p.planVehicleId).length, Number(plan.totalKm ?? 0)]);
  total.font = negrita;
  const sin = paradas.filter((p) => !p.planVehicleId);
  if (plan.status === "CALCULADA" && sin.length) {
    res.addRow([]);
    res.addRow([`Sin móvil (no entran por capacidad): ${sin.map((p) => p.customer).join(", ")}`]).font = { ...negrita, color: { argb: "FFB91C1C" } };
  }

  // Una pestaña por móvil.
  for (const m of conRuta) {
    const ws = wb.addWorksheet(m.plate.replace(/[\\/*?:[\]]/g, "-").slice(0, 31));
    ws.columns = [
      { width: 5 }, { width: 14 }, { width: 34 }, { width: 14 }, { width: 44 }, { width: 22 }, { width: 30 },
      { width: 9 }, { width: 9 }, { width: 12 }, { width: 40 },
    ];
    ws.addRow([`Móvil ${m.plate} · ${Number(m.km).toFixed(1)} km · ${m.minutes ?? 0} min · ${Number(m.loadKg ?? 0).toFixed(1)} kg`]).font = { ...negrita, size: 12 };
    ws.addRow([`Reparto del ${formatDate(plan.serviceDate)} · sale de la cochera, carga en ${centro.name}, vuelve a la cochera`]).font = { name: "Arial", size: 10, italic: true };
    ws.addRow([]);
    const h = ws.addRow(["N°", "Pedido(s)", "Cliente", "Teléfono", "Dirección", "Distrito", "Referencia", "Kg", "m³", "Entrega hasta", "Observación"]);
    h.font = negrita;
    h.eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFC20E" } }; c.alignment = { vertical: "middle", wrapText: true }; });
    for (const p of paradas.filter((x) => x.planVehicleId === m.id).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))) {
      const r = ws.addRow([
        p.sequence, p.orders.join(", "), p.customer, p.phone ?? "", p.address, p.district, p.reference ?? "",
        Number(p.kg), Number(p.m3), p.deadline ? formatDate(p.deadline) : "", p.notes ?? "",
      ]);
      r.alignment = { vertical: "top", wrapText: true };
      r.font = { name: "Arial", size: 10 };
    }
    ws.views = [{ state: "frozen", ySplit: 4 }];
  }

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(new Uint8Array(buf as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Rutas ${plan.serviceDate}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
