"use server";

import { inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { supplierInvoices } from "@/db/schema";
import { BusinessError, toActionError, type ActionResult } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireActionUser } from "@/lib/auth";
import { destinationVariants } from "@/server/invoice-queries";
import { destinoCanonico } from "@/server/invoice-service";

/**
 * Limpieza de destinos de las facturas.
 *
 * El destino se escribe a mano, y lo que vino del Excel lo trae de mil maneras:
 * "BARRANCA", "barranca", "Barranca ". Cada una contaba como un destino distinto en el
 * filtro y en los totales por destino. Esto las deja todas con un mismo nombre.
 */

/**
 * Pone un mismo nombre a varias escrituras de un destino.
 *
 * También sirve para juntar dos destinos que no son solo mayúsculas ("Barranca - Lima"
 * con "Barranca"): si el nombre final ya existe escrito de otra forma, se usa esa forma.
 */
export async function renameDestination(formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("invoices.manage");
    const variantes = formData.getAll("variante").map(String).filter(Boolean);
    const escrito = String(formData.get("final") ?? "").replace(/\s+/g, " ").trim();
    if (variantes.length === 0) throw new BusinessError("No hay ningún destino que cambiar.");
    if (!escrito) throw new BusinessError("Escribe el nombre con el que debe quedar.");
    if (escrito.length > 120) throw new BusinessError("El nombre del destino es demasiado largo.");

    const resultado = await db.transaction(async (tx) => {
      // Si el nombre elegido ya existe con otra escritura (que no sea de las que se están
      // cambiando), se adopta esa: así renombrar sirve también para juntar dos destinos.
      const existente = await destinoCanonico(tx, escrito);
      const final = existente && !variantes.includes(existente) ? existente : escrito;
      const cambiadas = await tx.update(supplierInvoices)
        .set({ destinationCity: final, updatedAt: new Date() })
        .where(inArray(supplierInvoices.destinationCity, variantes))
        .returning({ id: supplierInvoices.id });
      await logAudit({
        user, action: "EDITAR", module: "FACTURAS", recordId: null,
        description: `${user.name} unificó el destino de ${cambiadas.length} factura(s): `
          + `${variantes.map((v) => `"${v}"`).join(", ")} → "${final}".`,
        oldData: { variantes }, newData: { final, facturas: cambiadas.length },
      }, tx);
      return { final, cambiadas: cambiadas.length };
    });

    revalidatePath("/", "layout");
    return { ok: true, message: `${resultado.cambiadas} factura(s) quedaron con destino "${resultado.final}".` };
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Unifica de una vez todos los destinos que solo difieren en mayúsculas, tildes o
 * espacios: cada grupo queda con la escritura que usan más facturas.
 */
export async function unifyAllDestinations(): Promise<ActionResult> {
  try {
    const user = await requireActionUser("invoices.manage");
    const grupos = (await destinationVariants()).filter((g) => g.variantes.length > 1);
    if (grupos.length === 0) return { ok: true, message: "No hay destinos escritos de varias maneras." };

    const total = await db.transaction(async (tx) => {
      let cambiadas = 0;
      for (const g of grupos) {
        const final = g.variantes[0].name.replace(/\s+/g, " ").trim();
        const otras = g.variantes.map((v) => v.name).filter((n) => n !== final);
        const filas = await tx.update(supplierInvoices)
          .set({ destinationCity: final, updatedAt: new Date() })
          .where(sql`${supplierInvoices.destinationCity} in (${sql.join(otras.map((o) => sql`${o}`), sql`, `)})`)
          .returning({ id: supplierInvoices.id });
        cambiadas += filas.length;
      }
      await logAudit({
        user, action: "EDITAR", module: "FACTURAS", recordId: null,
        description: `${user.name} unificó ${grupos.length} destino(s) escritos de varias maneras (${cambiadas} factura(s)): `
          + grupos.map((g) => `"${g.variantes[0].name}"`).join(", ") + ".",
        newData: grupos.map((g) => ({ final: g.variantes[0].name, variantes: g.variantes.map((v) => v.name) })),
      }, tx);
      return cambiadas;
    });

    revalidatePath("/", "layout");
    return { ok: true, message: `Listo: ${grupos.length} destino(s) unificados, ${total} factura(s) corregidas.` };
  } catch (e) {
    return toActionError(e);
  }
}
