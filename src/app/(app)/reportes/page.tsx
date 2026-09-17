import { FileDown, FileSpreadsheet, FileText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { FilterBar, type FilterDef } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth";
import { cn, first, formatNumber, MOVEMENT_LABEL, STOCK_STATUS_LABEL, type SearchParams } from "@/lib/utils";
import { DELIVERY_STATE_LABEL, getCategoryOptions, getEmployeeOptions, getProductOptions, getUserOptions, readFilters } from "@/server/queries";
import { buildReport, isReportType, REPORT_TYPES, type ReportType } from "@/server/reports";

export const metadata: Metadata = { title: "Reportes" };
const PREVIEW_ROWS = 50;
const NOWRAP = new Set(["date", "code", "type", "dni", "size", "status", "quantity", "before", "after", "stock", "minimum", "state"]);

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  await requirePageUser("reports.view");
  const sp = await searchParams;
  const tipoParam = first(sp.tipo);
  const tipo: ReportType = isReportType(tipoParam) ? tipoParam : "inventario";
  const f = readFilters(sp);

  const [report, categories, products, employees, users] = await Promise.all([
    buildReport(tipo, f), getCategoryOptions(true), getProductOptions(), getEmployeeOptions(), getUserOptions(),
  ]);

  const opt = {
    category: { type: "select", name: "category", label: "Categoría", allLabel: "Todas", options: categories.map((c) => ({ value: c.id, label: c.name })) },
    product: { type: "select", name: "product", label: "Producto", options: products.map((p) => ({ value: p.id, label: `${p.code} · ${p.name}` })) },
    employee: { type: "select", name: "employee", label: "Trabajador", options: employees.map((e) => ({ value: e.id, label: `${e.lastName}, ${e.firstName}` })) },
    user: { type: "select", name: "user", label: "Usuario", options: users.map((u) => ({ value: u.id, label: u.name })) },
    type: { type: "select", name: "type", label: "Tipo de movimiento", options: Object.entries(MOVEMENT_LABEL).map(([value, label]) => ({ value, label })) },
    status: { type: "select", name: "status", label: "Estado", options: Object.entries(STOCK_STATUS_LABEL).map(([value, label]) => ({ value, label })) },
    deliveryState: { type: "select", name: "estado", label: "Estado", allLabel: "Todas", options: Object.entries(DELIVERY_STATE_LABEL).map(([value, label]) => ({ value, label })) },
    from: { type: "date", name: "from", label: "Fecha inicial" },
    to: { type: "date", name: "to", label: "Fecha final" },
  } satisfies Record<string, FilterDef>;

  const filters: FilterDef[] =
    tipo === "inventario" ? [opt.category, opt.product, opt.status]
    : tipo === "movimientos" ? [opt.from, opt.to, opt.type, opt.product, opt.category, opt.employee, opt.user]
    : [opt.from, opt.to, opt.employee, opt.product, opt.category, opt.user, opt.deliveryState];

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string" && v) qs.set(k, v);
  qs.set("tipo", tipo);
  const exportHref = (format: string) => `/api/export?${qs}&format=${format}`;
  const exportCls = "inline-flex h-10 items-center gap-2 rounded-md border px-4 text-[15px] transition-colors";

  return (
    <>
      <PageHeader
        title="Reportes"
        description="Elige un reporte, aplica filtros y descárgalo en Excel, CSV o PDF."
        actions={
          <>
            <a href={exportHref("xlsx")} className={cn(exportCls, "border-brand-dark/30 bg-brand font-semibold hover:bg-brand-dark")}><FileSpreadsheet className="h-4 w-4" /> Exportar Excel</a>
            <a href={exportHref("csv")} className={cn(exportCls, "border-steel-300 bg-white hover:border-ink")}><FileDown className="h-4 w-4" /> CSV</a>
            <a href={exportHref("pdf")} className={cn(exportCls, "border-steel-300 bg-white hover:border-ink")}><FileText className="h-4 w-4" /> PDF</a>
          </>
        }
      />

      <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-steel-200" aria-label="Tipo de reporte">
        {(Object.keys(REPORT_TYPES) as ReportType[]).map((t) => (
          <Link
            key={t}
            href={`/reportes?tipo=${t}`}
            aria-current={t === tipo ? "page" : undefined}
            className={cn(
              "-mb-px whitespace-nowrap border-b-[3px] px-4 py-2.5 text-[15px] font-medium",
              t === tipo ? "border-brand text-ink" : "border-transparent text-steel-500 hover:text-ink",
            )}
          >
            {REPORT_TYPES[t].replace("Reporte de ", "").replace(/^./, (c) => c.toUpperCase())}
          </Link>
        ))}
      </nav>

      <FilterBar key={tipo} filters={filters} />

      <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {report.summary.map((s) => (
          <div key={s.label} className="rounded-lg border border-steel-200 bg-white px-4 py-3">
            <dt className="text-xs text-steel-500">{s.label}</dt>
            <dd className="font-display text-2xl font-bold tabular">{formatNumber(s.value)}</dd>
          </div>
        ))}
      </dl>

      <TableShell>
        <thead>
          <tr>{report.columns.map((c) => <Th key={c.key} className={c.align === "right" ? "text-right" : ""}>{c.header}</Th>)}</tr>
        </thead>
        <tbody>
          {report.rows.length === 0 && <EmptyRow colSpan={report.columns.length} title="No hay datos para estos filtros" />}
          {report.rows.slice(0, PREVIEW_ROWS).map((row, i) => (
            <Tr key={i} className={cn(row.state === "Anulada" && "text-steel-400 [&_td]:text-steel-400")}>
              {report.columns.map((c) => (
                <Td key={c.key} className={cn(c.align === "right" && "text-right tabular", NOWRAP.has(c.key) && "whitespace-nowrap", (c.key === "notes" || c.key === "voidInfo") && "max-w-[14rem] truncate")}>
                  {row[c.key] === "" ? "—" : row[c.key]}
                </Td>
              ))}
            </Tr>
          ))}
        </tbody>
      </TableShell>
      {report.rows.length > PREVIEW_ROWS && (
        <p className="mt-3 text-sm text-steel-500">
          Vista previa de {PREVIEW_ROWS} de {formatNumber(report.rows.length)} filas. La exportación incluye todas.
        </p>
      )}
    </>
  );
}
