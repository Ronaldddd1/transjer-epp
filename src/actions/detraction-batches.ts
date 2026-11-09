"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { detractionBatches, supplierInvoices, suppliers } from "@/db/schema";
import { BusinessError, formToObject, toActionError, type ActionResult } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireActionUser } from "@/lib/auth";
import {
  armarArchivo, esCuentaBN, limpiarCuenta, MAXIMO_POR_LOTE, problemasDeDeposito, textoSunat,
} from "@/lib/sunat-detracciones";
import { formatDate, formatMoney, invoiceNumber, todayLima } from "@/lib/utils";
import { condicionesParaLote, depositoDe, facturasDeLote, obtenerLote } from "@/server/detraction-batches";
import { guardarVoucher, leerVoucher } from "@/server/payment-proof";

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");

const nuevoLoteSchema = z.object({
  rucPagador: z.string().trim().regex(/^\d{11}$/, "El RUC de la empresa tiene 11 dígitos"),
  razonSocialPagador: z.string().trim().min(1, "Escribe la razón social de la empresa")
    .refine((v) => textoSunat(v).length > 0, "Escribe la razón social de la empresa"),
  lote: z.string().trim().regex(/^\d{6}$/, "El número de lote es AANNNN: 6 dígitos, como 260001"),
});

const pagoLoteSchema = z.object({
  fecha: ymd,
  operacion: z.string().trim().min(1, "Anota el número de operación o de orden de pago").max(40),
  notas: z.string().trim().max(1000).optional().transform((v) => (v ? v : null)),
});

/**
 * Arma un lote de pago masivo con las detracciones marcadas y lo deja listo para SUNAT.
 *
 * Las detracciones pasan a "En proceso": ya están en un archivo y no conviene ponerlas en
 * otro. Si a algún proveedor le falta la cuenta del Banco de la Nación, se puede escribir
 * en el mismo formulario y queda guardada en su ficha.
 */
export async function crearLoteDetracciones(formData: FormData): Promise<ActionResult & { loteId?: string }> {
  try {
    const user = await requireActionUser("detractions.manage");
    const data = nuevoLoteSchema.parse(formToObject(formData));
    const ids = [...new Set(formData.getAll("ids").map(String))].filter((v) => /^[0-9a-f-]{36}$/i.test(v));
    if (ids.length === 0) throw new BusinessError("Marca al menos una detracción pendiente.");
    if (ids.length > MAXIMO_POR_LOTE) throw new BusinessError(`Un archivo de SUNAT admite hasta ${MAXIMO_POR_LOTE} detracciones.`);
    if (data.lote.slice(0, 2) > todayLima().slice(2, 4)) {
      throw new BusinessError("El lote empieza con el año (26 para 2026): no puede ser de un año que no llegó.");
    }

    // Las cuentas que se escribieron en el formulario, por proveedor.
    const cuentas = new Map<string, string>();
    const errores: Record<string, string> = {};
    formData.forEach((valor, clave) => {
      if (!clave.startsWith("cuenta_") || typeof valor !== "string" || !valor.trim()) return;
      const cuenta = limpiarCuenta(valor);
      if (!esCuentaBN(cuenta)) errores[clave] = "Son 11 dígitos";
      else cuentas.set(clave.slice("cuenta_".length), cuenta);
    });
    if (Object.keys(errores).length) {
      return { ok: false, message: "Revisa las cuentas del Banco de la Nación: tienen 11 dígitos.", fieldErrors: errores };
    }

    const resultado = await db.transaction(async (tx) => {
      const facturas = await tx.select({
        id: supplierInvoices.id,
        series: supplierInvoices.series,
        number: supplierInvoices.number,
        docType: supplierInvoices.docType,
        issueDate: supplierInvoices.issueDate,
        currency: supplierInvoices.currency,
        detractionAmount: supplierInvoices.detractionAmount,
        supplierId: suppliers.id,
        supplierName: suppliers.businessName,
        supplierRuc: suppliers.ruc,
        supplierAccount: suppliers.detractionAccount,
      }).from(supplierInvoices)
        .innerJoin(suppliers, eq(suppliers.id, supplierInvoices.supplierId))
        .where(condicionesParaLote(ids))
        .for("update", { of: supplierInvoices });

      if (facturas.length !== ids.length) {
        throw new BusinessError(
          `${ids.length - facturas.length} de las marcadas ya no están pendientes (otra persona las movió o ya van en otro lote). Recarga la página y vuelve a marcar.`,
        );
      }

      // Guardar las cuentas nuevas en la ficha de cada proveedor.
      const proveedoresDelLote = new Map(facturas.map((f) => [f.supplierId, f]));
      for (const [supplierId, cuenta] of cuentas) {
        const p = proveedoresDelLote.get(supplierId);
        if (!p || p.supplierAccount === cuenta) continue;
        await tx.update(suppliers).set({ detractionAccount: cuenta, updatedAt: new Date() }).where(eq(suppliers.id, supplierId));
        await logAudit({
          user, action: "EDITAR", module: "PROVEEDORES", recordId: supplierId,
          description: `${user.name} anotó la cuenta de detracciones ${cuenta} de ${p.supplierName} al armar un pago masivo.`,
          oldData: { detractionAccount: p.supplierAccount }, newData: { detractionAccount: cuenta },
        }, tx);
      }
      const conCuenta = facturas.map((f) => ({ ...f, supplierAccount: cuentas.get(f.supplierId) ?? f.supplierAccount }));

      const problemas = conCuenta
        .map((f) => ({ f, p: problemasDeDeposito(depositoDe(f)) }))
        .filter((x) => x.p.length > 0);
      if (problemas.length) {
        const detalle = problemas.slice(0, 4).map(({ f, p }) => `${invoiceNumber(f.series, f.number)} (${f.supplierName}): ${p.join(", ")}`);
        throw new BusinessError(
          `No se puede armar el archivo. ${detalle.join(". ")}${problemas.length > 4 ? `. Y ${problemas.length - 4} más.` : "."}`,
        );
      }

      const [repetido] = await tx.select({ id: detractionBatches.id }).from(detractionBatches)
        .where(and(eq(detractionBatches.payerRuc, data.rucPagador), eq(detractionBatches.lot, data.lote))).limit(1);
      if (repetido) {
        return { error: { lote: `El lote ${data.lote} ya se usó. SUNAT no deja repetirlo: usa el siguiente.` }, lote: null, archivo: null };
      }

      // Se arma ya, para no guardar un lote que después no se pueda descargar.
      const archivo = armarArchivo({
        rucPagador: data.rucPagador,
        razonSocialPagador: data.razonSocialPagador,
        lote: data.lote,
        depositos: conCuenta.map(depositoDe),
      });

      const [lote] = await tx.insert(detractionBatches).values({
        lot: data.lote,
        payerRuc: data.rucPagador,
        payerName: textoSunat(data.razonSocialPagador).slice(0, 35),
        total: archivo.total.toFixed(2),
        invoiceCount: facturas.length,
        createdBy: user.id,
      }).returning();

      await tx.update(supplierInvoices).set({
        detractionStatus: "EN_PROCESO",
        detractionBatchId: lote.id,
        detractionBy: user.id,
        updatedAt: new Date(),
      }).where(inArray(supplierInvoices.id, ids));

      await logAudit({
        user, action: "CREAR", module: "DETRACCIONES", recordId: lote.id,
        description: `${user.name} armó el lote ${lote.lot} de pago masivo a SUNAT: ${facturas.length} detracción(es) por ${formatMoney(archivo.total.toFixed(2))}.`,
        newData: { lote: lote.lot, archivo: archivo.nombre, facturas: facturas.map((f) => invoiceNumber(f.series, f.number)) },
      }, tx);
      return { error: null, lote, archivo };
    });

    if (resultado.error) {
      return { ok: false, message: resultado.error.lote, fieldErrors: resultado.error };
    }
    if (!resultado.lote || !resultado.archivo) throw new BusinessError("No se pudo armar el lote.");
    revalidatePath("/", "layout");
    return {
      ok: true,
      loteId: resultado.lote.id,
      message: `Lote ${resultado.lote.lot} listo: ${resultado.lote.invoiceCount} detracción(es) por ${formatMoney(resultado.lote.total)}. Se descarga el archivo ${resultado.archivo.nombre}.`,
    };
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Registra el pago de un lote: con una sola constancia, todas sus detracciones quedan
 * pagadas. Si alguna se registró pagada a mano antes, se respeta y no se toca.
 */
export async function registrarPagoLote(loteId: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("detractions.manage");
    const data = pagoLoteSchema.parse(formToObject(formData));
    if (data.fecha > todayLima()) throw new BusinessError("La fecha del pago no puede ser futura.");

    const lote = await obtenerLote(loteId);
    if (!lote) throw new BusinessError("El lote no existe.");
    if (lote.status !== "GENERADO") throw new BusinessError(`El lote ${lote.lot} ya está ${lote.status === "PAGADO" ? "pagado" : "anulado"}.`);
    const creado = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(lote.createdAt);
    if (data.fecha < creado) {
      throw new BusinessError(`El lote se armó el ${formatDate(creado)}: el pago no puede ser de antes.`);
    }

    const voucher = await leerVoucher(formData, {
      requerido: true,
      falta: "Sube la constancia del pago de SUNAT (la captura o el PDF): es lo que respalda las detracciones del lote.",
    });

    const facturas = await facturasDeLote(loteId);
    const porPagar = facturas.filter((f) => f.detractionStatus === "EN_PROCESO");
    if (porPagar.length === 0) {
      throw new BusinessError("Ninguna detracción de este lote sigue en proceso. Si se pagaron una por una, anula el lote.");
    }

    const resultado = await db.transaction(async (tx) => {
      // Una sola copia de la constancia, guardada en la primera factura del lote; las demás
      // apuntan a ella.
      const proofId = await guardarVoucher(tx, voucher!, { invoiceId: porPagar[0].id, uploadedBy: user.id });

      for (const f of porPagar) {
        const propia = String(formData.get(`constancia_${f.id}`) ?? "").trim().slice(0, 40);
        await tx.update(supplierInvoices).set({
          detractionStatus: "PAGADA",
          detractionPaidAt: data.fecha,
          detractionReceipt: propia || data.operacion,
          detractionOperation: data.operacion,
          detractionProofId: proofId,
          detractionBy: user.id,
          updatedAt: new Date(),
        }).where(and(eq(supplierInvoices.id, f.id), eq(supplierInvoices.detractionStatus, "EN_PROCESO")));
      }

      const [pagado] = await tx.update(detractionBatches).set({
        status: "PAGADO",
        paidAt: data.fecha,
        operation: data.operacion,
        proofId,
        notes: data.notas,
        paidBy: user.id,
        updatedAt: new Date(),
      }).where(and(eq(detractionBatches.id, loteId), eq(detractionBatches.status, "GENERADO"))).returning();
      if (!pagado) throw new BusinessError("Otra persona cambió este lote mientras tanto. Recarga la página.");

      await logAudit({
        user, action: "EDITAR", module: "DETRACCIONES", recordId: loteId,
        description: `${user.name} registró el pago del lote ${lote.lot} el ${formatDate(data.fecha)}, operación ${data.operacion}: `
          + `${porPagar.length} detracción(es) quedaron pagadas`
          + (porPagar.length < facturas.length ? ` (${facturas.length - porPagar.length} ya estaban registradas aparte)` : "")
          + ".",
        oldData: { estado: lote.status },
        newData: { estado: "PAGADO", fecha: data.fecha, operacion: data.operacion, facturas: porPagar.map((f) => invoiceNumber(f.series, f.number)) },
      }, tx);
      return pagado;
    });

    revalidatePath("/", "layout");
    return {
      ok: true,
      message: `Lote ${resultado.lot} pagado: ${porPagar.length} detracción(es) quedaron depositadas con la constancia.`,
    };
  } catch (e) {
    return toActionError(e);
  }
}

/** Para un lote que no se llegó a pagar: sus detracciones vuelven a pendientes. */
export async function anularLote(loteId: string): Promise<ActionResult> {
  try {
    const user = await requireActionUser("detractions.manage");
    const lote = await obtenerLote(loteId);
    if (!lote) throw new BusinessError("El lote no existe.");
    if (lote.status !== "GENERADO") throw new BusinessError("Solo se anula un lote que todavía no se pagó.");

    const devueltas = await db.transaction(async (tx) => {
      const filas = await tx.update(supplierInvoices).set({
        detractionStatus: "PENDIENTE",
        detractionBatchId: null,
        updatedAt: new Date(),
      }).where(and(eq(supplierInvoices.detractionBatchId, loteId), eq(supplierInvoices.detractionStatus, "EN_PROCESO")))
        .returning({ series: supplierInvoices.series, number: supplierInvoices.number });

      await tx.update(detractionBatches).set({ status: "ANULADO", updatedAt: new Date() })
        .where(eq(detractionBatches.id, loteId));

      await logAudit({
        user, action: "EDITAR", module: "DETRACCIONES", recordId: loteId,
        description: `${user.name} anuló el lote ${lote.lot} sin pagar: ${filas.length} detracción(es) volvieron a pendientes.`,
        oldData: { estado: lote.status }, newData: { estado: "ANULADO", facturas: filas.map((f) => invoiceNumber(f.series, f.number)) },
      }, tx);
      return filas.length;
    });

    revalidatePath("/", "layout");
    return { ok: true, message: `Lote ${lote.lot} anulado: ${devueltas} detracción(es) volvieron a pendientes. El número ${lote.lot} no se vuelve a usar.` };
  } catch (e) {
    return toActionError(e);
  }
}

