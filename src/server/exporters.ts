import "server-only";
import ExcelJS from "exceljs";
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { formatDateTime } from "@/lib/utils";
import type { Report } from "./reports";

const META = (r: Report) => `Transjer Operador Logístico S.A.C. — ${r.title}`;

export function toCsv(entrada: Report | Report[]) {
  const report = Array.isArray(entrada) ? entrada[0] : entrada;
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [
    report.columns.map((c) => esc(c.header)).join(","),
    ...report.rows.map((row) => report.columns.map((c) => esc(row[c.key])).join(",")),
  ];
  // BOM para que Excel abra correctamente tildes y ñ
  return "\uFEFF" + lines.join("\r\n");
}

/** Un nombre de hoja válido para Excel: sin los caracteres que prohíbe y de 31 letras como mucho. */
function nombreDeHoja(titulo: string, usados: Set<string>) {
  const base = titulo.replace("Reporte de ", "").replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Hoja";
  let nombre = base;
  let n = 2;
  while (usados.has(nombre)) nombre = `${base.slice(0, 28)} ${n++}`;
  usados.add(nombre);
  return nombre;
}

/**
 * Excel con una hoja por tabla.
 *
 * Varias pantallas muestran más de una tabla a la vez —el resumen de EPP trae una por
 * producto y otra por trabajador— y separarlas en dos archivos obligaría a cruzarlas a mano.
 */
export async function toXlsx(report: Report | Report[], filtersText: string, generatedBy: string) {
  const reports = Array.isArray(report) ? report : [report];
  const wb = new ExcelJS.Workbook();
  wb.creator = "Transjer Gestión";
  wb.created = new Date();
  const usados = new Set<string>();
  for (const r of reports) hoja(wb, r, filtersText, generatedBy, usados);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function hoja(wb: ExcelJS.Workbook, report: Report, filtersText: string, generatedBy: string, usados: Set<string>) {
  const ws = wb.addWorksheet(nombreDeHoja(report.title, usados), { views: [{ state: "frozen", ySplit: 5 }] });
  const lastCol = report.columns.length;

  ws.mergeCells(1, 1, 1, lastCol);
  ws.getCell(1, 1).value = META(report);
  ws.getCell(1, 1).font = { bold: true, size: 14 };
  ws.mergeCells(2, 1, 2, lastCol);
  ws.getCell(2, 1).value = filtersText;
  ws.getCell(2, 1).font = { color: { argb: "FF52525A" } };
  ws.mergeCells(3, 1, 3, lastCol);
  ws.getCell(3, 1).value = `Generado el ${formatDateTime(new Date())} por ${generatedBy} · ${report.summary.map((s) => `${s.label}: ${s.value}`).join(" · ")}`;
  ws.getCell(3, 1).font = { color: { argb: "FF52525A" }, size: 10 };

  const header = ws.getRow(5);
  report.columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: "FF000000" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFC20E" } };
    cell.alignment = { vertical: "middle", horizontal: c.align ?? "left" };
    ws.getColumn(i + 1).width = c.width;
  });
  header.height = 20;

  report.rows.forEach((row, r) => {
    const excelRow = ws.getRow(6 + r);
    report.columns.forEach((c, i) => {
      const cell = excelRow.getCell(i + 1);
      cell.value = row[c.key];
      if (c.align) cell.alignment = { horizontal: c.align };
      cell.border = { bottom: { style: "hair", color: { argb: "FFE1E1E5" } } };
    });
  });
  // El autofiltro necesita al menos la fila de encabezados; con la tabla vacía Excel se queja.
  if (report.rows.length > 0) {
    ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5 + report.rows.length, column: lastCol } };
  }
}

export function toPdf(entrada: Report | Report[], filtersText: string, generatedBy: string) {
  const report = Array.isArray(entrada) ? entrada[0] : entrada;
  const doc = new jsPDF({ orientation: report.columns.length > 8 ? "landscape" : "portrait", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFillColor(255, 194, 14);
  doc.rect(0, 0, pageWidth, 4, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(report.title, 14, 15);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(82, 82, 90);
  doc.text("Transjer Operador Logístico S.A.C.", 14, 20.5);
  doc.text(doc.splitTextToSize(filtersText, pageWidth - 28), 14, 25.5);
  doc.text(report.summary.map((s) => `${s.label}: ${s.value}`).join("    "), 14, 31);

  const totalWidth = report.columns.reduce((s, c) => s + c.width, 0);
  autoTable(doc, {
    startY: 35,
    head: [report.columns.map((c) => c.header)],
    body: report.rows.map((row) => report.columns.map((c) => String(row[c.key] ?? ""))),
    styles: { fontSize: 7.5, cellPadding: 1.6, overflow: "linebreak" },
    headStyles: { fillColor: [0, 0, 0], textColor: [255, 255, 255], fontStyle: "bold" },
    alternateRowStyles: { fillColor: [247, 247, 248] },
    columnStyles: Object.fromEntries(report.columns.map((c, i) => [i, {
      halign: c.align ?? "left",
      cellWidth: ((pageWidth - 28) * c.width) / totalWidth,
    }])),
    margin: { left: 14, right: 14 },
    didDrawPage: () => {
      const h = doc.internal.pageSize.getHeight();
      doc.setFontSize(8);
      doc.setTextColor(110, 110, 118);
      doc.text(`Generado el ${formatDateTime(new Date())} por ${generatedBy}`, 14, h - 7);
      doc.text(`Página ${doc.getCurrentPageInfo().pageNumber}`, pageWidth - 14, h - 7, { align: "right" });
    },
  });

  return Buffer.from(doc.output("arraybuffer"));
}
