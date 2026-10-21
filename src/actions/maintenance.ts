"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { maintenancePlans, maintenanceRecords, vehicles } from "@/db/schema";
import { BusinessError, formToObject, toActionError, type ActionResult } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireActionUser } from "@/lib/auth";
import { formatDate, MAINTENANCE_KIND_LABEL, todayLima, type MaintenanceKind } from "@/lib/utils";
import { maintenancePlanSchema, maintenanceSchema, odometerSchema } from "@/lib/validations";

/**
 * Mantenimiento de la flota.
 *
 * Registrar un servicio hace dos cosas: deja el historial y, si trae kilometraje, adelanta
 * el odómetro de la unidad. Eso último es lo que evita el trabajo doble: quien anota el
 * cambio de aceite ya está leyendo el tablero, y obligarle a actualizar el kilometraje por
 * separado es la forma segura de que nadie lo haga.
 */

async function cargarVehiculo(id: string) {
  const [v] = await db.select().from(vehicles).where(eq(vehicles.id, id)).limit(1);
  if (!v) throw new BusinessError("Ese vehículo ya no existe.");
  return v;
}

const etiqueta = (kind: string) => MAINTENANCE_KIND_LABEL[kind as MaintenanceKind] ?? kind;

export async function registerMaintenance(vehicleId: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("maintenance.manage");
    const data = maintenanceSchema.parse(formToObject(formData));
    const vehiculo = await cargarVehiculo(vehicleId);

    if (data.servicedAt > todayLima()) {
      throw new BusinessError("La fecha del servicio no puede ser futura.");
    }

    /**
     * Un kilometraje menor que el que ya tiene la unidad casi siempre es un error de
     * tecleo —180.000 escrito como 18.000—, y pasarlo adelante dejaría el próximo
     * mantenimiento calculado sobre un número falso. Se avisa, salvo que el servicio sea
     * anterior a la última lectura, que entonces es normal que sea menor.
     */
    const retrocede = data.odometerKm !== null
      && vehiculo.odometerKm !== null
      && data.odometerKm < vehiculo.odometerKm
      && (!vehiculo.odometerAt || data.servicedAt >= vehiculo.odometerAt);
    if (retrocede) {
      throw new BusinessError(
        `La unidad ${vehiculo.plate} ya tiene ${vehiculo.odometerKm!.toLocaleString("es-PE")} km anotados`
        + ` y estás registrando ${data.odometerKm!.toLocaleString("es-PE")}. Revisa el número;`
        + " si de verdad retrocedió (cambio de tablero), corrige antes el kilometraje de la unidad.",
      );
    }

    const fila = await db.transaction(async (tx) => {
      const [row] = await tx.insert(maintenanceRecords).values({
        vehicleId,
        kind: data.kind,
        servicedAt: data.servicedAt,
        odometerKm: data.odometerKm,
        cost: data.cost,
        workshop: data.workshop,
        notes: data.notes,
        createdBy: user.id,
      }).returning();

      // El odómetro de la unidad solo avanza, nunca retrocede por un servicio viejo que
      // se registra ahora.
      if (data.odometerKm !== null && (vehiculo.odometerKm === null || data.odometerKm > vehiculo.odometerKm)) {
        await tx.update(vehicles)
          .set({ odometerKm: data.odometerKm, odometerAt: data.servicedAt, updatedAt: new Date() })
          .where(eq(vehicles.id, vehicleId));
      }

      await logAudit({
        user, action: "CREAR", module: "MANTENIMIENTO", recordId: row.id,
        description: `${user.name} registró ${etiqueta(data.kind).toLowerCase()} de ${vehiculo.plate}`
          + ` el ${formatDate(data.servicedAt)}`
          + (data.odometerKm !== null ? ` con ${data.odometerKm.toLocaleString("es-PE")} km` : "")
          + ".",
        newData: row,
      }, tx);
      return row;
    });

    revalidatePath("/", "layout");
    return {
      ok: true,
      message: `${etiqueta(fila.kind)} de ${vehiculo.plate} registrado.`
        + (data.odometerKm !== null ? ` El kilometraje de la unidad quedó en ${data.odometerKm.toLocaleString("es-PE")} km.` : ""),
    };
  } catch (e) {
    return toActionError(e);
  }
}

export async function deleteMaintenance(id: string): Promise<ActionResult> {
  try {
    const user = await requireActionUser("maintenance.manage");
    const [row] = await db.select().from(maintenanceRecords)
      .where(eq(maintenanceRecords.id, id)).limit(1);
    if (!row) throw new BusinessError("Ese registro ya no existe.");
    const vehiculo = await cargarVehiculo(row.vehicleId);

    await db.delete(maintenanceRecords).where(eq(maintenanceRecords.id, id));

    await logAudit({
      user, action: "ELIMINAR", module: "MANTENIMIENTO", recordId: id,
      description: `${user.name} borró ${etiqueta(row.kind).toLowerCase()} de ${vehiculo.plate}`
        + ` del ${formatDate(row.servicedAt)}.`,
      oldData: row,
    });

    revalidatePath("/", "layout");
    // El odómetro de la unidad no se toca: la lectura ocurrió igual, y bajarlo dejaría los
    // cálculos peor de lo que estaban.
    return { ok: true, message: "Registro eliminado. El kilometraje de la unidad se mantiene." };
  } catch (e) {
    return toActionError(e);
  }
}

/** Anota la lectura del odómetro, sin registrar ningún servicio. */
export async function setOdometer(vehicleId: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("maintenance.manage");
    const data = odometerSchema.parse(formToObject(formData));
    const vehiculo = await cargarVehiculo(vehicleId);

    if (data.odometerAt > todayLima()) {
      throw new BusinessError("La fecha de la lectura no puede ser futura.");
    }

    await db.update(vehicles).set({
      odometerKm: data.odometerKm,
      odometerAt: data.odometerAt,
      updatedAt: new Date(),
    }).where(eq(vehicles.id, vehicleId));

    await logAudit({
      user, action: "EDITAR", module: "MANTENIMIENTO", recordId: vehicleId,
      description: `${user.name} anotó ${data.odometerKm.toLocaleString("es-PE")} km en ${vehiculo.plate}`
        + ` (lectura del ${formatDate(data.odometerAt)}).`,
      oldData: { km: vehiculo.odometerKm, fecha: vehiculo.odometerAt },
      newData: { km: data.odometerKm, fecha: data.odometerAt },
    });

    revalidatePath("/", "layout");
    return { ok: true, message: `${vehiculo.plate} quedó con ${data.odometerKm.toLocaleString("es-PE")} km.` };
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Cambia cada cuánto le toca un mantenimiento a una unidad.
 *
 * Mientras nadie toque esto, cada unidad usa la periodicidad corriente de su tipo. Esto
 * existe para las excepciones: la unidad que trabaja en obra y cambia aceite cada 5.000, o
 * la que no se lava nunca porque no sale de almacén.
 */
export async function setMaintenancePlan(vehicleId: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("maintenance.manage");
    const data = maintenancePlanSchema.parse(formToObject(formData));
    const vehiculo = await cargarVehiculo(vehicleId);

    const [existe] = await db.select().from(maintenancePlans).where(and(
      eq(maintenancePlans.vehicleId, vehicleId),
      eq(maintenancePlans.kind, data.kind),
    )).limit(1);

    const valores = {
      everyKm: data.everyKm,
      everyDays: data.everyDays,
      active: data.active,
      notes: data.notes,
    };

    if (existe) {
      await db.update(maintenancePlans).set({ ...valores, updatedAt: new Date() })
        .where(eq(maintenancePlans.id, existe.id));
    } else {
      await db.insert(maintenancePlans).values({ vehicleId, kind: data.kind, ...valores });
    }

    await logAudit({
      user, action: "EDITAR", module: "MANTENIMIENTO", recordId: vehicleId,
      description: data.active
        ? `${user.name} fijó ${etiqueta(data.kind).toLowerCase()} de ${vehiculo.plate} `
          + [data.everyKm && `cada ${data.everyKm.toLocaleString("es-PE")} km`,
            data.everyDays && `cada ${data.everyDays} día(s)`].filter(Boolean).join(" o ") + "."
        : `${user.name} quitó ${etiqueta(data.kind).toLowerCase()} del plan de ${vehiculo.plate}.`,
      oldData: existe ?? null,
      newData: valores,
    });

    revalidatePath("/", "layout");
    return {
      ok: true,
      message: data.active
        ? `Listo: ${etiqueta(data.kind).toLowerCase()} de ${vehiculo.plate} con su propia periodicidad.`
        : `${etiqueta(data.kind)} ya no se le controla a ${vehiculo.plate}.`,
    };
  } catch (e) {
    return toActionError(e);
  }
}
