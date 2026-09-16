import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { todayLima } from "@/lib/utils";
import { toCsv, toPdf, toXlsx } from "@/server/exporters";
import { readFilters } from "@/server/queries";
import { filterNames } from "@/server/report-names";
import { buildReport, describeFilters, isReportType } from "@/server/reports";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(user.role, "reports.view")) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });

  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const tipo = sp.tipo;
  const format = sp.format;
  if (!isReportType(tipo)) return NextResponse.json({ error: "Tipo de reporte inválido" }, { status: 400 });

  const filters = readFilters(sp);
  const [report, names] = await Promise.all([buildReport(tipo, filters), filterNames(filters)]);
  const filtersText = describeFilters(filters, names);
  const filename = `transjer-${tipo}-${todayLima()}`;

  if (format === "csv") {
    return new NextResponse(toCsv(report), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}.csv"` },
    });
  }
  if (format === "xlsx") {
    const body = await toXlsx(report, filtersText, user.name);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}.xlsx"`,
      },
    });
  }
  if (format === "pdf") {
    const body = toPdf(report, filtersText, user.name);
    return new NextResponse(new Uint8Array(body), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}.pdf"` },
    });
  }
  return NextResponse.json({ error: "Formato inválido" }, { status: 400 });
}
