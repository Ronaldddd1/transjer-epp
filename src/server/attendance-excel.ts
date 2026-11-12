import "server-only";
import ExcelJS from "exceljs";
import { addDays } from "@/lib/utils";
import type { attendanceWeek } from "./attendance-queries";

/**
 * La semana de asistencia con el formato de la hoja de TransJer (ASISTENCIA_TRANSJER.xlsx).
 *
 * Es el formato con el que se lleva la asistencia a mano, así que el Excel del sistema sale
 * igual para poder pegarlo en el libro de siempre o compararlo con él:
 *
 *   - A1:B1 el mes; desde C1, el nombre de cada día. A2:B2 "NOMBRES"; desde C2, el número
 *     del día. Las dos filas en amarillo y negrita.
 *   - Una fila por trabajador: nombres en A, apellidos en B.
 *   - En cada día, lo que hizo (el cliente, la ruta, "OFICINA"…), en mayúsculas.
 *     Si faltó, "NO TRABAJO" con el fondo rojo. Si está justificado, el motivo.
 *     Si no hay registro, la celda queda vacía.
 *   - Bordes finos en todo, letra Calibri y el texto centrado.
 */

type Semana = Awaited<ReturnType<typeof attendanceWeek>>;

const MESES = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SETIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
const DIAS = ["LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO", "DOMINGO"];
const AMARILLO = "FFFFFF00";
const ROJO = "FFFF0000";

const mes = (ymd: string) => MESES[Number(ymd.slice(5, 7)) - 1];
const dia = (ymd: string) => Number(ymd.slice(8, 10));

/** Lo que va en la casilla de un día. */
export function casillaAsistencia(d: { status: string; activity: string | null; reason: string | null } | undefined) {
  if (!d) return { texto: "", falta: false };
  if (d.status === "FALTA") return { texto: "NO TRABAJO", falta: true };
  if (d.status === "JUSTIFICADO") return { texto: (d.reason?.trim() || "JUSTIFICADO").toUpperCase(), falta: false };
  return { texto: (d.activity?.trim() || "ASISTIO").toUpperCase(), falta: false };
}

/** "NOV 02-08", o "OCT 27-NOV 02" cuando la semana cruza de mes. Excel admite hasta 31 caracteres. */
export function nombreHojaSemana(lunes: string) {
  const domingo = addDays(lunes, 6);
  const dd = (s: string) => s.slice(8, 10);
  return mes(lunes) === mes(domingo)
    ? `${mes(lunes).slice(0, 3)} ${dd(lunes)}-${dd(domingo)}`
    : `${mes(lunes).slice(0, 3)} ${dd(lunes)}-${mes(domingo).slice(0, 3)} ${dd(domingo)}`;
}

export function nombreArchivoSemana(lunes: string) {
  return `ASISTENCIA TRANSJER ${nombreHojaSemana(lunes)} ${addDays(lunes, 6).slice(0, 4)}.xlsx`;
}

export async function asistenciaSemanaXlsx(semana: Semana): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Transjer Gestión";
  wb.created = new Date();
  const ws = wb.addWorksheet(nombreHojaSemana(semana.lunes), {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  });

  const fino = { style: "thin" as const };
  const borde = { top: fino, left: fino, bottom: fino, right: fino };
  const centro = { horizontal: "center" as const, vertical: "middle" as const };
  const ultimaCol = 2 + semana.dias.length;

  // --- Cabecera: el mes y los días ---
  const mesInicio = mes(semana.lunes);
  const mesFin = mes(semana.domingo);
  ws.mergeCells(1, 1, 1, 2);
  ws.getCell(1, 1).value = mesInicio === mesFin ? mesInicio : `${mesInicio} - ${mesFin}`;
  ws.mergeCells(2, 1, 2, 2);
  ws.getCell(2, 1).value = "NOMBRES";
  semana.dias.forEach((d, i) => {
    ws.getCell(1, 3 + i).value = DIAS[i];
    ws.getCell(2, 3 + i).value = dia(d);
  });
  for (const fila of [1, 2]) {
    for (let c = 1; c <= ultimaCol; c++) {
      const cell = ws.getCell(fila, c);
      cell.font = { name: "Calibri", size: 12, bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AMARILLO } };
      cell.alignment = centro;
      cell.border = borde;
    }
    ws.getRow(fila).height = 15.75;
  }

  // --- Una fila por trabajador ---
  const largos = semana.dias.map(() => 10);
  semana.filas.forEach((t, r) => {
    const fila = 3 + r;
    ws.getCell(fila, 1).value = t.firstName.trim().toUpperCase();
    ws.getCell(fila, 2).value = t.lastName.trim().toUpperCase();
    semana.dias.forEach((d, i) => {
      const { texto, falta } = casillaAsistencia(t.semana[d]);
      const cell = ws.getCell(fila, 3 + i);
      if (texto) cell.value = texto;
      if (falta) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ROJO } };
      largos[i] = Math.max(largos[i], texto.length);
    });
    for (let c = 1; c <= ultimaCol; c++) {
      const cell = ws.getCell(fila, c);
      cell.font = { name: "Calibri", size: 11 };
      cell.alignment = centro;
      cell.border = borde;
    }
  });

  ws.getColumn(1).width = 19.6;
  ws.getColumn(2).width = 21.6;
  largos.forEach((n, i) => { ws.getColumn(3 + i).width = Math.min(Math.max(18, n + 3), 34); });

  return Buffer.from(await wb.xlsx.writeBuffer());
}
