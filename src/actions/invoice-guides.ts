"use server";

import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { invoiceGuides, supplierInvoices } from "@/db/schema";
import { BusinessError, formToObject, toActionError, type ActionResult } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { AuthError, getCurrentUser } from "@/lib/auth";
import { GUIA_TIPO_LABEL } from "@/lib/guias";
import { can } from "@/lib/permissions";
import { formatDate, invoiceNumber, todayLima } from "@/lib/utils";
import { aplicarReglaGuias } from "@/server/invoice-guides";

/**
 * Las guías de una factura de transporte: anotar que llegaron, agregar las que faltaban en
 * la lista, quitar una mal escrita, deshacer una llegada anotada por error. Todo termina en
 * aplicarReglaGuias, que deja la fecha límite de la factura según la última guía.
 *
 * Lo puede hacer quien maneja Facturas o quien maneja las Salidas: la guía la recibe
 * cualquiera de los dos.
 */

async function usuarioConPermiso() {
  const user = await getCurrentUser();
  if (!user) throw new AuthError("Tu sesión expiró. Vuelve a iniciar sesión.");
  if (!can(user, "invoices.manage") && !can(user, "trips.manage")) {
    throw new AuthError("No tienes permiso para anotar guías.");
  }
  return user;
}

async function facturaDeTransporte(invoiceId: string) {
  const [f] = await db.select().from(supplierInvoices).where(eq(supplierInvoices.id, invoiceId)).limit(1);
  if (!f) throw new BusinessError("La factura no existe.");
  if (f.serviceType !== "TRANSPORTE") throw new BusinessError("Solo las facturas de transporte llevan guías.");
  if (f.status === "ANULADA") throw new BusinessError("La factura está anulada.");
  return f;
}

const etiqueta = (f: { series: string; number: string }) => invoiceNumber(f.series, f.number);
const nombreGuia = (g: { number: string | null; kind: string }) =>
  g.number ?? `${GUIA_TIPO_LABEL[g.kind as keyof typeof GUIA_TIPO_LABEL] ?? "guía"} sin número`;

function mensajeVencimiento(f: { payDueDate: string | null; status: string }) {
  if (f.status !== "PENDIENTE") return "";
  return f.payDueDate
    ? ` Llegaron todas: la factura vence el ${formatDate(f.payDueDate)}.`
    : " Todavía falta alguna guía: la factura no tiene fecha de pago hasta que llegue la última.";
}

const llegadaSchema = z.object({
  fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Indica el día que llegó"),
});

/** Anota que llegaron las guías marcadas (o todas las que faltaban, si no se marcó ninguna). */
export async function marcarGuiasLlegadas(invoiceId: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await usuarioConPermiso();
    const { fecha } = llegadaSchema.parse(formToObject(formData));
    if (fecha > todayLima()) throw new BusinessError("La fecha de llegada no puede ser futura.");
    const factura = await facturaDeTransporte(invoiceId);
    const marcadas = formData.getAll("guias").map(String).filter(Boolean);

    const despues = await db.transaction(async (tx) => {
      const pendientes = await tx.select().from(invoiceGuides)
        .where(and(eq(invoiceGuides.invoiceId, invoiceId), isNull(invoiceGuides.receivedAt),
          marcadas.length ? inArray(invoiceGuides.id, marcadas) : undefined));
      if (!pendientes.length) throw new BusinessError("No hay guías por llegar en esta factura.");
      await tx.update(invoiceGuides).set({ receivedAt: fecha, receivedBy: user.id, updatedAt: new Date() })
        .where(inArray(invoiceGuides.id, pendientes.map((g) => g.id)));
      const row = (await aplicarReglaGuias(tx, invoiceId))!;
      await logAudit({
        user, action: "EDITAR", module: "FACTURAS", recordId: invoiceId,
        description: `${user.name} anotó que llegaron ${pendientes.length} guía(s) de la factura ${etiqueta(factura)} `
          + `(${pendientes.map(nombreGuia).join(", ")}) el ${formatDate(fecha)}.`
          + (row.payDueDate && factura.status === "PENDIENTE" ? ` Vence el ${formatDate(row.payDueDate)}.` : ""),
        oldData: { guideReceivedAt: factura.guideReceivedAt, payDueDate: factura.payDueDate },
        newData: { guideReceivedAt: row.guideReceivedAt, payDueDate: row.payDueDate },
      }, tx);
      return { row, cuantas: pendientes.length };
    });
    revalidatePath("/", "layout");
    return { ok: true, message: `${despues.cuantas} guía(s) anotada(s) como llegadas.${mensajeVencimiento(despues.row)}` };
  } catch (e) {
    return toActionError(e);
  }
}

const nuevaGuiaSchema = z.object({
  numero: z.string().trim().max(40).optional().transform((v) => (v ? v.replace(/\s+/g, " ").toUpperCase() : null)),
  tipo: z.enum(["TRANSPORTISTA", "REMITENTE"]).default("TRANSPORTISTA"),
  llego: z.string().optional().transform((v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)),
});

/** Agrega una guía que faltaba en la lista. Si todavía no llegó, la factura vuelve a esperar. */
export async function agregarGuia(invoiceId: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await usuarioConPermiso();
    const data = nuevaGuiaSchema.parse(formToObject(formData));
    if (data.llego && data.llego > todayLima()) throw new BusinessError("La fecha de llegada no puede ser futura.");
    const factura = await facturaDeTransporte(invoiceId);

    const row = await db.transaction(async (tx) => {
      if (data.numero) {
        const [repetida] = await tx.select({ id: invoiceGuides.id }).from(invoiceGuides)
          .where(and(eq(invoiceGuides.invoiceId, invoiceId), eq(invoiceGuides.number, data.numero))).limit(1);
        if (repetida) throw new BusinessError(`La guía ${data.numero} ya está en esta factura.`);
      }
      await tx.insert(invoiceGuides).values({
        invoiceId, kind: data.tipo, number: data.numero,
        receivedAt: data.llego, receivedBy: data.llego ? user.id : null, createdBy: user.id,
      });
      const r = (await aplicarReglaGuias(tx, invoiceId))!;
      await logAudit({
        user, action: "EDITAR", module: "FACTURAS", recordId: invoiceId,
        description: `${user.name} agregó la guía ${nombreGuia({ number: data.numero, kind: data.tipo })} a la factura ${etiqueta(factura)}`
          + (data.llego ? `, llegada el ${formatDate(data.llego)}.` : ", todavía por llegar."),
        oldData: { payDueDate: factura.payDueDate }, newData: { payDueDate: r.payDueDate },
      }, tx);
      return r;
    });
    revalidatePath("/", "layout");
    return { ok: true, message: `Guía agregada.${mensajeVencimiento(row)}` };
  } catch (e) {
    return toActionError(e);
  }
}

/** Quita una guía mal escrita o que no correspondía. La última no se quita. */
export async function quitarGuia(guiaId: string): Promise<ActionResult> {
  try {
    const user = await usuarioConPermiso();
    const [guia] = await db.select().from(invoiceGuides).where(eq(invoiceGuides.id, guiaId)).limit(1);
    if (!guia) throw new BusinessError("La guía no existe.");
    const factura = await facturaDeTransporte(guia.invoiceId);
    const [{ cuantas }] = await db.select({ cuantas: count() }).from(invoiceGuides).where(eq(invoiceGuides.invoiceId, guia.invoiceId));
    if (cuantas <= 1) throw new BusinessError("Es la única guía de la factura: corrígela en lugar de quitarla.");

    const row = await db.transaction(async (tx) => {
      await tx.delete(invoiceGuides).where(eq(invoiceGuides.id, guiaId));
      const r = (await aplicarReglaGuias(tx, guia.invoiceId))!;
      await logAudit({
        user, action: "EDITAR", module: "FACTURAS", recordId: guia.invoiceId,
        description: `${user.name} quitó la guía ${nombreGuia(guia)} de la factura ${etiqueta(factura)}.`,
        oldData: guia, newData: { payDueDate: r.payDueDate },
      }, tx);
      return r;
    });
    revalidatePath("/", "layout");
    return { ok: true, message: `Guía quitada.${mensajeVencimiento(row)}` };
  } catch (e) {
    return toActionError(e);
  }
}

/** Para una llegada anotada por error: la guía vuelve a figurar por llegar. */
export async function deshacerLlegadaGuia(guiaId: string): Promise<ActionResult> {
  try {
    const user = await usuarioConPermiso();
    const [guia] = await db.select().from(invoiceGuides).where(eq(invoiceGuides.id, guiaId)).limit(1);
    if (!guia) throw new BusinessError("La guía no existe.");
    if (!guia.receivedAt) throw new BusinessError("Esa guía todavía no figura como llegada.");
    const factura = await facturaDeTransporte(guia.invoiceId);
    if (factura.status === "PAGADA") throw new BusinessError("La factura ya está pagada.");

    const row = await db.transaction(async (tx) => {
      await tx.update(invoiceGuides).set({ receivedAt: null, receivedBy: null, updatedAt: new Date() })
        .where(eq(invoiceGuides.id, guiaId));
      const r = (await aplicarReglaGuias(tx, guia.invoiceId))!;
      await logAudit({
        user, action: "EDITAR", module: "FACTURAS", recordId: guia.invoiceId,
        description: `${user.name} deshizo la llegada de la guía ${nombreGuia(guia)} de la factura ${etiqueta(factura)} `
          + `(figuraba llegada el ${formatDate(guia.receivedAt)}).`,
        oldData: { receivedAt: guia.receivedAt, payDueDate: factura.payDueDate }, newData: { receivedAt: null, payDueDate: r.payDueDate },
      }, tx);
      return r;
    });
    revalidatePath("/", "layout");
    return { ok: true, message: `La guía vuelve a figurar por llegar.${mensajeVencimiento(row)}` };
  } catch (e) {
    return toActionError(e);
  }
}

