import "server-only";
import { formatDate, formatDateTime, MOVEMENT_LABEL, STOCK_STATUS_LABEL, stockStatus } from "@/lib/utils";
import { listDeliveries, listMovements, listProducts, type ReportFilters } from "./queries";

export const REPORT_TYPES = { inventario: "Reporte de inventario", movimientos: "Reporte de movimientos", entregas: "Reporte de entregas" } as const;
export type ReportType = keyof typeof REPORT_TYPES;

export type ReportColumn = { key: string; header: string; width: number; align?: "right" };
export type Report = {
  title: string;
  columns: ReportColumn[];
  rows: Record<string, string | number>[];
  summary: { label: string; value: number }[];
};

export function isReportType(v: string | undefined): v is ReportType {
  return !!v && v in REPORT_TYPES;
}

export async function buildReport(type: ReportType, f: ReportFilters): Promise<Report> {
  if (type === "inventario") {
    const { rows } = await listProducts({ categoryId: f.categoryId, status: f.status, q: f.q, sort: "code" });
    const data = rows.filter((p) => !f.productId || p.id === f.productId);
    const statuses = data.map((p) => stockStatus(p.stock, p.minimumStock));
    return {
      title: REPORT_TYPES.inventario,
      columns: [
        { key: "code", header: "Código", width: 12 },
        { key: "name", header: "Producto", width: 30 },
        { key: "category", header: "Categoría", width: 22 },
        { key: "brand", header: "Marca", width: 14 },
        { key: "size", header: "Talla", width: 8 },
        { key: "unit", header: "Unidad", width: 10 },
        { key: "stock", header: "Stock", width: 9, align: "right" },
        { key: "minimum", header: "Stock mínimo", width: 12, align: "right" },
        { key: "status", header: "Estado", width: 12 },
      ],
      rows: data.map((p, i) => ({
        code: p.code, name: p.name, category: p.categoryName, brand: p.brand ?? "", size: p.size ?? "", unit: p.unit,
        stock: p.stock, minimum: p.minimumStock, status: STOCK_STATUS_LABEL[statuses[i]],
      })),
      summary: [
        { label: "Productos", value: data.length },
        { label: "Unidades en stock", value: data.reduce((s, p) => s + p.stock, 0) },
        { label: "Con stock bajo", value: statuses.filter((s) => s === "STOCK_BAJO").length },
        { label: "Agotados", value: statuses.filter((s) => s === "AGOTADO").length },
      ],
    };
  }

  if (type === "movimientos") {
    const { rows } = await listMovements(f);
    const sum = (t: string) => rows.filter((r) => r.type === t).reduce((s, r) => s + r.quantity, 0);
    return {
      title: REPORT_TYPES.movimientos,
      columns: [
        { key: "date", header: "Fecha", width: 17 },
        { key: "type", header: "Tipo", width: 10 },
        { key: "code", header: "Código", width: 12 },
        { key: "product", header: "Producto", width: 28 },
        { key: "quantity", header: "Cantidad", width: 10, align: "right" },
        { key: "before", header: "Stock antes", width: 11, align: "right" },
        { key: "after", header: "Stock después", width: 12, align: "right" },
        { key: "reason", header: "Motivo", width: 26 },
        { key: "employee", header: "Trabajador", width: 22 },
        { key: "user", header: "Usuario", width: 18 },
        { key: "notes", header: "Observaciones", width: 28 },
      ],
      rows: rows.map((m) => ({
        date: formatDateTime(m.createdAt), type: MOVEMENT_LABEL[m.type], code: m.productCode, product: m.productName,
        quantity: m.type === "SALIDA" ? -m.quantity : m.quantity, before: m.stockBefore, after: m.stockAfter,
        reason: m.reason, employee: m.employeeName ?? "", user: m.userName, notes: m.notes ?? "",
      })),
      summary: [
        { label: "Movimientos", value: rows.length },
        { label: "Unidades ingresadas", value: sum("ENTRADA") },
        { label: "Unidades retiradas", value: sum("SALIDA") },
        { label: "Ajuste neto", value: sum("AJUSTE") },
      ],
    };
  }

  const { rows } = await listDeliveries(f);
  return {
    title: REPORT_TYPES.entregas,
    columns: [
      { key: "date", header: "Fecha", width: 11 },
      { key: "employee", header: "Trabajador", width: 26 },
      { key: "dni", header: "DNI", width: 11 },
      { key: "position", header: "Cargo", width: 18 },
      { key: "area", header: "Área", width: 14 },
      { key: "product", header: "EPP", width: 26 },
      { key: "size", header: "Talla", width: 8 },
      { key: "quantity", header: "Cantidad", width: 10, align: "right" },
      { key: "reason", header: "Motivo", width: 20 },
      { key: "user", header: "Responsable", width: 18 },
    ],
    rows: rows.map((d) => ({
      date: formatDate(d.deliveryDate), employee: d.employeeName, dni: d.dni, position: d.position, area: d.area,
      product: d.productName, size: d.size ?? "", quantity: d.quantity, reason: d.reason, user: d.userName,
    })),
    summary: [
      { label: "Entregas", value: rows.length },
      { label: "Unidades entregadas", value: rows.reduce((s, d) => s + d.quantity, 0) },
      { label: "Trabajadores atendidos", value: new Set(rows.map((d) => d.dni)).size },
    ],
  };
}

export function describeFilters(f: ReportFilters, names: { product?: string; category?: string; employee?: string; user?: string }) {
  const parts: string[] = [];
  if (f.from || f.to) parts.push(`Periodo: ${f.from ? formatDate(f.from) : "inicio"} – ${f.to ? formatDate(f.to) : "hoy"}`);
  if (names.product) parts.push(`Producto: ${names.product}`);
  if (names.category) parts.push(`Categoría: ${names.category}`);
  if (names.employee) parts.push(`Trabajador: ${names.employee}`);
  if (names.user) parts.push(`Usuario: ${names.user}`);
  if (f.type) parts.push(`Tipo: ${MOVEMENT_LABEL[f.type]}`);
  if (f.status) parts.push(`Estado: ${STOCK_STATUS_LABEL[f.status]}`);
  return parts.join("   |   ") || "Sin filtros";
}
