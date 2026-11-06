import "server-only";
import { and, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { DOCUMENT_KIND_LABEL, formatDate } from "@/lib/utils";

/**
 * Avisos de documentos de la flota por vencer: SOAT, revisión técnica, póliza, MTC…
 *
 * Funciona igual que el aviso de cuotas (ver reminders.ts): el servidor de avisos del VPS
 * pregunta cada mañana, manda el WhatsApp y vuelve para marcar lo avisado. Cada documento
 * se avisa una vez.
 *
 * La antelación es de una semana, no de dos días como los pagos: renovar un SOAT o sacar
 * cita para la revisión técnica lleva días, y una unidad con el papel vencido no puede
 * salir a ruta.
 */

export type AvisoDocumento = {
  id: string;
  vehiculoId: string;
  placa: string;
  tipo: string;
  documento: string;
  vence: string;
  /** Días que faltan: 0 es hoy, 1 mañana. */
  dias: number;
  conductor: string | null;
};

/** Días de antelación por defecto: una semana. */
export const DIAS_DE_AVISO_DOCUMENTOS = 7;

const hoySql = sql`((now() at time zone 'America/Lima')::date)`;

/**
 * Los documentos de la flota por vencer que todavía no se han avisado.
 *
 * Toma todo lo que vence de hoy hasta dentro de `dias`, no solo lo que cae justo en el
 * séptimo día: si el VPS estuvo caído una mañana, al día siguiente recupera lo pendiente.
 *
 * Quedan fuera:
 *  - lo que ya venció: eso no es un aviso anticipado, y al estrenar el aviso habría
 *    llegado de golpe todo lo vencido que arrastra el Excel;
 *  - las unidades de baja y los datos de demostración;
 *  - un documento que ya tiene reemplazo: si el SOAT nuevo ya está cargado con una fecha
 *    posterior, el viejo puede vencer tranquilo y avisarlo sería ruido.
 */
export async function avisosDeDocumentos(dias = DIAS_DE_AVISO_DOCUMENTOS): Promise<AvisoDocumento[]> {
  const limite = Math.max(0, Math.min(60, Math.trunc(dias)));

  const filas = await db.execute<{
    id: string; vehiculo_id: string; placa: string; tipo: string; titulo: string | null;
    vence: string; dias: number; conductor: string | null;
  }>(sql`
    select d.id, v.id as vehiculo_id, v.plate as placa, d.kind as tipo, d.title as titulo,
           d.expires_at::text as vence,
           (d.expires_at - ${hoySql})::int as dias,
           nullif(concat_ws(' ', e.first_name, e.last_name), '') as conductor
    from documents d
    join vehicles v on v.id = d.vehicle_id
    left join employees e on e.id = v.driver_id
    where v.active and not v.is_demo and not d.is_demo
      and d.reminder_sent_at is null
      and d.expires_at is not null
      and d.expires_at >= ${hoySql}
      and d.expires_at <= ${hoySql} + ${limite}::int
      and not exists (
        select 1 from documents n
        where n.vehicle_id = d.vehicle_id
          and n.kind = d.kind
          and n.id <> d.id
          and n.expires_at > d.expires_at
          -- Dos "Otro" solo son el mismo papel si se llaman igual.
          and (d.kind <> 'OTRO' or coalesce(n.title, '') = coalesce(d.title, ''))
      )
    order by d.expires_at asc, v.plate asc
  `);

  return [...filas].map((f) => {
    const etiqueta = DOCUMENT_KIND_LABEL[f.tipo] ?? f.tipo;
    const titulo = f.titulo?.trim();
    return {
      id: f.id,
      vehiculoId: f.vehiculo_id,
      placa: f.placa,
      tipo: f.tipo,
      documento: titulo && titulo.toLowerCase() !== etiqueta.toLowerCase() ? `${etiqueta} (${titulo})` : etiqueta,
      vence: f.vence,
      dias: Number(f.dias),
      conductor: f.conductor,
    };
  });
}

/** Marca como avisados los documentos que el servidor de avisos consiguió enviar. */
export async function marcarDocumentosAvisados(ids: string[]): Promise<number> {
  const limpios = ids.filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
  if (limpios.length === 0) return 0;
  const marcados = await db.update(documents)
    .set({ reminderSentAt: new Date() })
    .where(and(inArray(documents.id, limpios), isNull(documents.reminderSentAt)))
    .returning({ id: documents.id });
  return marcados.length;
}

const cuando = (dias: number) => (dias === 0 ? "vence HOY" : dias === 1 ? "mañana" : `en ${dias} días`);

/**
 * El texto del WhatsApp. `web` es la dirección de Transjer Gestión, para dejar el enlace a
 * la flota al final; sin ella el mensaje sale igual, sin enlace.
 */
export function mensajeDeDocumentos(filas: AvisoDocumento[], web?: string): string | null {
  if (filas.length === 0) return null;

  const lineas = filas.map((f) => {
    const conductor = f.conductor ? `\n   Conductor: ${f.conductor}` : "";
    return `• *${f.placa}* — ${f.documento}\n   Vence el *${formatDate(f.vence)}* (${cuando(f.dias)})${conductor}`;
  });

  const unidades = new Set(filas.map((f) => f.placa)).size;

  // Las líneas en blanco van a propósito: en el celular separan el encabezado, la lista y
  // el cierre. Por eso no se filtra con filter(Boolean), que también se las llevaría.
  const partes = [
    `*Transjer Gestión* — documentos de flota por vencer`,
    "",
    `${filas.length} documento(s) de ${unidades} unidad(es):`,
    "",
    lineas.join("\n"),
    "",
    "Al renovarlo, carga el nuevo con su fecha en Documentos.",
  ];
  if (web) partes.push(`${web.replace(/\/$/, "")}/documentos/vehiculos`);
  return partes.join("\n");
}
