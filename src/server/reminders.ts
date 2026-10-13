import "server-only";
import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { obligationInstallments, obligations } from "@/db/schema";
import { formatDate, formatMoney, OBLIGATION_TYPE_LABEL, type ObligationTypeKey } from "@/lib/utils";

/**
 * Avisos de vencimiento de préstamos y servicios.
 *
 * El servidor de avisos vive en el VPS de la empresa, detrás de Tailscale y sin puertos
 * abiertos a internet. Por eso el que pregunta es él: cada mañana consulta aquí qué vence,
 * envía los WhatsApp y vuelve para marcar lo avisado. Transjer Gestión no necesita saber
 * nada de WhatsApp ni alcanzar al VPS, y el VPS sigue sin exponerse.
 *
 * Una cuota se avisa una sola vez. Sin esa marca, el mismo vencimiento llegaría cada día
 * hasta pagarse y la gente dejaría de leer los mensajes.
 */

export type AvisoCuota = {
  id: string;
  obligacion: string;
  entidad: string;
  tipo: ObligationTypeKey;
  referencia: string | null;
  numero: number;
  vence: string;
  /** Días que faltan: 0 es hoy, 1 mañana. */
  dias: number;
  importe: string | null;
  moneda: string;
};

/** Días de antelación por defecto. Dos: da tiempo a mover el dinero sin avisar tan pronto que se olvide. */
export const DIAS_DE_AVISO = 2;

const hoySql = sql`((now() at time zone 'America/Lima')::date)`;

/**
 * Las cuotas por vencer que todavía no se han avisado.
 *
 * Toma todo lo que vence de hoy hasta dentro de `dias`, no solo lo que vence exactamente
 * ese día: si el servidor de avisos estuvo caído una mañana, al día siguiente recupera lo
 * que se habría perdido en vez de saltárselo.
 */
export async function avisosPendientes(dias = DIAS_DE_AVISO): Promise<AvisoCuota[]> {
  const limite = Math.max(0, Math.min(30, Math.trunc(dias)));

  const filas = await db.select({
    id: obligationInstallments.id,
    obligacion: obligations.name,
    entidad: obligations.creditor,
    tipo: obligations.type,
    referencia: obligations.reference,
    numero: obligationInstallments.number,
    vence: obligationInstallments.dueDate,
    dias: sql<number>`(${obligationInstallments.dueDate} - ${hoySql})::int`,
    importe: obligationInstallments.total,
    moneda: obligations.currency,
  })
    .from(obligationInstallments)
    .innerJoin(obligations, eq(obligations.id, obligationInstallments.obligationId))
    .where(and(
      eq(obligations.status, "ACTIVA"),
      eq(obligationInstallments.status, "PENDIENTE"),
      isNull(obligationInstallments.reminderSentAt),
      // Desde hoy en adelante: lo ya vencido no es un aviso anticipado, es otra conversación.
      sql`${obligationInstallments.dueDate} >= ${hoySql}`,
      // El tipo del parámetro va explícito: `fecha + $1` a secas deja a Postgres sin saber
      // si se le suman días o un intervalo, y rechaza la consulta.
      lte(obligationInstallments.dueDate, sql`${hoySql} + ${limite}::int`),
    ))
    .orderBy(asc(obligationInstallments.dueDate), asc(obligations.name));

  return filas.map((f) => ({ ...f, tipo: f.tipo as ObligationTypeKey, dias: Number(f.dias) }));
}

/** Marca como avisadas las cuotas que el servidor de avisos consiguió enviar. */
export async function marcarAvisadas(ids: string[]): Promise<number> {
  const limpios = ids.filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
  if (limpios.length === 0) return 0;
  const marcadas = await db.update(obligationInstallments)
    .set({ reminderSentAt: new Date() })
    .where(and(
      inArray(obligationInstallments.id, limpios),
      isNull(obligationInstallments.reminderSentAt),
    ))
    .returning({ id: obligationInstallments.id });
  return marcadas.length;
}

const cuando = (dias: number) => (dias === 0 ? "hoy" : dias === 1 ? "mañana" : `en ${dias} días`);

/**
 * El texto del WhatsApp.
 *
 * Se arma aquí y no en el VPS para que el mensaje viva junto a los datos que describe: si
 * mañana se agrega un dato a la cuota, se cambia en un solo sitio.
 */
export function mensajeDeAvisos(filas: AvisoCuota[]): string | null {
  if (filas.length === 0) return null;

  const lineas = filas.map((f) => {
    const importe = f.importe ? formatMoney(f.importe, f.moneda) : "falta el importe";
    const detalle = f.tipo === "PRESTAMO" ? `cuota ${f.numero}` : OBLIGATION_TYPE_LABEL[f.tipo].toLowerCase();
    return `• *${formatDate(f.vence)}* (${cuando(f.dias)}) — ${f.obligacion}\n   ${f.entidad} · ${detalle} · ${importe}`;
  });

  // Los totales van por moneda: sumar soles con dólares daría una cifra que no existe.
  const porMoneda = new Map<string, number>();
  for (const f of filas) {
    if (!f.importe) continue;
    porMoneda.set(f.moneda, (porMoneda.get(f.moneda) ?? 0) + Number(f.importe));
  }
  const totales = [...porMoneda.entries()].map(([m, v]) => formatMoney(v.toFixed(2), m)).join(" + ");
  const sinImporte = filas.filter((f) => !f.importe).length;

  return [
    `*Transjer Gestión* — pagos por vencer`,
    "",
    `${filas.length} cuota(s) vencen pronto:`,
    "",
    lineas.join("\n"),
    "",
    `*Total: ${totales || "—"}*`,
    sinImporte > 0 ? `_${sinImporte} sin importe: falta cargar el recibo._` : "",
  ].filter(Boolean).join("\n");
}
