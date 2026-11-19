import "server-only";
import ExcelJS from "exceljs";
import { leerProgramacion, ubicarColumnas } from "@/lib/rutas/programacion";

/** El valor de una celda tal como se ve: el resultado de una fórmula, el texto enriquecido. */
function valor(c: ExcelJS.CellValue): unknown {
  if (c === null || c === undefined) return null;
  if (c instanceof Date) return c;
  if (typeof c === "object") {
    if ("result" in c) return (c as { result: unknown }).result ?? null;
    if ("richText" in c) return (c as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
    if ("text" in c) return (c as { text: string }).text;
    if ("hyperlink" in c) return (c as { text?: string }).text ?? null;
    return null;
  }
  return c;
}

/**
 * Lee el Excel de programación del cliente.
 *
 * Busca la hoja que trae una fila por producto (la que tiene Pedido, Dirección y
 * Distrito); en el archivo de hoy se llama "LISTA DE PEDIDOS FINAL", pero si cambia de
 * nombre se sigue encontrando por sus columnas. La hoja "RESUMEN" no sirve: no trae
 * la dirección.
 */
export async function leerExcelProgramacion(buffer: ArrayBuffer | Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);
  const hojas = wb.worksheets.map((ws) => {
    const filas: unknown[][] = [];
    ws.eachRow({ includeEmpty: true }, (r) => {
      const v = (r.values as ExcelJS.CellValue[]).slice(1);
      filas[r.number - 1] = v.map(valor);
    });
    return { nombre: ws.name, filas: Array.from(filas, (f) => f ?? []) };
  });
  const hoja = hojas.find((h) => /PEDIDOS/i.test(h.nombre) && ubicarColumnas(h.filas))
    ?? hojas.find((h) => ubicarColumnas(h.filas));
  if (!hoja) {
    return { hoja: null, paradas: [], descartadas: 0, error: "El Excel no tiene una hoja con las columnas Pedido, Dirección y Distrito." };
  }
  return { hoja: hoja.nombre, ...leerProgramacion(hoja.filas) };
}
