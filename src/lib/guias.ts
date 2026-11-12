import { computePayDueDate } from "./utils";

/**
 * Las guías de una factura de transporte y el plazo que arrancan.
 *
 * Una factura de transporte se paga 15 días después de que llega en físico la última de
 * sus guías. Mientras falte alguna, no tiene fecha de pago: no se puede saber cuándo el
 * proveedor va a traerla, y pagar sin la guía es pagar un viaje que no se puede probar.
 */

export const PLAZO_TRANSPORTE_DIAS = 15;

export const GUIA_TIPO_LABEL = {
  TRANSPORTISTA: "Guía del transportista",
  REMITENTE: "Guía del remitente",
} as const;
export type GuiaTipo = keyof typeof GUIA_TIPO_LABEL;

/**
 * Los números de guía escritos en un campo, uno por uno. Se escriben de muchas maneras:
 * "T001-123 / T001-124", "EG03-12, EG03-13", "T001-5 y T001-6".
 */
export function separarGuias(texto: string | null | undefined): string[] {
  if (!texto) return [];
  const vistos = new Set<string>();
  const salida: string[] = [];
  for (const parte of texto.split(/\s*[/,;|]\s*|\s+y\s+/i)) {
    const numero = parte.replace(/\s+/g, " ").trim().toUpperCase().slice(0, 40);
    if (!numero || vistos.has(numero)) continue;
    vistos.add(numero);
    salida.push(numero);
  }
  return salida;
}

export type GuiaEstado = { receivedAt: string | null };

/**
 * Cuándo llegó la última guía (null si falta alguna) y la fecha límite de pago que eso da.
 * El plazo corre desde la última guía, o desde que llegó la factura si la guía llegó antes:
 * no se paga una factura que todavía no existe.
 */
export function vencimientoPorGuias(guias: GuiaEstado[], receptionYmd: string) {
  const llegaron = guias.filter((g) => g.receivedAt).length;
  const completas = guias.length > 0 && llegaron === guias.length;
  const ultima = completas ? guias.map((g) => g.receivedAt!).sort().at(-1)! : null;
  return {
    total: guias.length,
    llegaron,
    completas,
    guideReceivedAt: ultima,
    payDueDate: ultima
      ? computePayDueDate({ paymentTerm: "CREDITO", termDays: PLAZO_TRANSPORTE_DIAS, receptionYmd, guideReceivedAt: ultima })
      : null,
  };
}
