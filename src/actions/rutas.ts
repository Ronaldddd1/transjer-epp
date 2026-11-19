"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { geoCache, routePlaces, routePlans, routePlanStops, routePlanVehicles } from "@/db/schema";
import { BusinessError, toActionError, type ActionResult } from "@/lib/action-result";
import { logAudit } from "@/lib/audit";
import { requireActionUser } from "@/lib/auth";
import { dentroDeLima, type Calidad } from "@/lib/rutas/geo";
import { leerMoviles } from "@/lib/rutas/moviles";
import { optimizar } from "@/lib/rutas/optimizar";
import { formatDate } from "@/lib/utils";
import { geocodificar } from "@/server/geocoder";
import { matriz, trazo } from "@/server/osrm";
import { lugares } from "@/server/rutas";
import { leerExcelProgramacion } from "@/server/rutas-excel";

const MAX_BYTES = 1_800_000;
const isYmd = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * Sube la programación del cliente y la deja lista para ubicar: una parada por dirección.
 * Las direcciones que ya se ubicaron antes (o se corrigieron a mano) salen ubicadas.
 */
export async function crearPlan(formData: FormData): Promise<ActionResult & { id?: string }> {
  try {
    const user = await requireActionUser("trips.manage");
    const archivo = formData.get("archivo");
    const fecha = String(formData.get("serviceDate") ?? "");
    const errores: Record<string, string> = {};
    if (!(archivo instanceof File) || archivo.size === 0) errores.archivo = "Elige el Excel de la programación";
    else if (!/\.xlsx$/i.test(archivo.name)) errores.archivo = "Tiene que ser un Excel (.xlsx)";
    else if (archivo.size > MAX_BYTES) errores.archivo = "El archivo pesa más de 1.8 MB";
    if (!isYmd(fecha)) errores.serviceDate = "Elige el día del reparto";
    if (Object.keys(errores).length) return { ok: false, message: "Revisa los campos marcados.", fieldErrors: errores };
    const file = archivo as File;

    const leido = await leerExcelProgramacion(Buffer.from(await file.arrayBuffer()));
    if (leido.error) return { ok: false, message: leido.error, fieldErrors: { archivo: leido.error } };

    const claves = leido.paradas.map((p) => p.clave);
    const conocidas = new Map((await db.select().from(geoCache).where(inArray(geoCache.key, claves))).map((g) => [g.key, g]));

    const id = await db.transaction(async (tx) => {
      const [plan] = await tx.insert(routePlans).values({
        serviceDate: fecha,
        name: `Reparto del ${formatDate(fecha)}`,
        fileName: file.name.slice(0, 240),
        createdBy: user.id,
      }).returning({ id: routePlans.id });
      await tx.insert(routePlanStops).values(leido.paradas.map((p) => {
        const g = conocidas.get(p.clave);
        return {
          planId: plan.id, addressKey: p.clave, orders: p.pedidos, customer: p.cliente.slice(0, 400),
          phone: p.telefono?.slice(0, 120) ?? null, address: p.direccion.slice(0, 400), cleanAddress: p.direccionLimpia.slice(0, 400),
          reference: p.referencia?.slice(0, 400) ?? null, district: p.distrito.slice(0, 80),
          dispatchType: p.tipoDespacho?.slice(0, 80) ?? null, agency: p.agencia?.slice(0, 160) ?? null,
          notes: p.observacion, zone: p.zona?.slice(0, 40) ?? null, deadline: p.fechaMax,
          kg: p.kg.toFixed(2), m3: p.m3.toFixed(4), products: p.productos,
          lat: g?.lat ?? null, lng: g?.lng ?? null, geoQuality: g?.quality ?? null, geoLabel: g?.label ?? null,
        };
      }));
      await logAudit({
        user, action: "CREAR", module: "RUTAS", recordId: plan.id,
        description: `${user.name} subió la programación del ${formatDate(fecha)} (${file.name}): ${leido.paradas.length} paradas.`,
        newData: { archivo: file.name, paradas: leido.paradas.length, hoja: leido.hoja },
      }, tx);
      return plan.id;
    });

    revalidatePath("/rutas");
    const ya = leido.paradas.filter((p) => conocidas.has(p.clave)).length;
    return {
      ok: true, id,
      message: `Programación cargada: ${leido.paradas.length} paradas${ya ? ` (${ya} ya ubicadas de antes)` : ""}.`,
    };
  } catch (e) {
    return toActionError(e);
  }
}

/** Ubica una parada en el mapa con OpenStreetMap y la recuerda para la próxima vez. */
export async function ubicarParada(stopId: string): Promise<ActionResult & { lat?: number; lng?: number; calidad?: Calidad; etiqueta?: string }> {
  try {
    const user = await requireActionUser("trips.manage");
    const [s] = await db.select().from(routePlanStops).where(eq(routePlanStops.id, stopId));
    if (!s) throw new BusinessError("La parada no existe.");
    if (s.lat != null && s.lng != null && s.geoQuality) {
      return { ok: true, message: "Ya estaba ubicada.", lat: s.lat, lng: s.lng, calidad: s.geoQuality as Calidad, etiqueta: s.geoLabel ?? "" };
    }
    const [conocida] = await db.select().from(geoCache).where(eq(geoCache.key, s.addressKey));
    const u = conocida
      ? { lat: conocida.lat, lng: conocida.lng, calidad: conocida.quality as Calidad, etiqueta: conocida.label ?? "", consulta: conocida.query ?? "" }
      : await geocodificar(s.cleanAddress, s.district);
    if (!u) {
      await db.update(routePlanStops).set({ geoQuality: "SIN_UBICAR" }).where(eq(routePlanStops.id, stopId));
      return { ok: true, message: "No se pudo ubicar: ponla a mano en el mapa.", calidad: "SIN_UBICAR" };
    }
    await db.update(routePlanStops).set({ lat: u.lat, lng: u.lng, geoQuality: u.calidad, geoLabel: u.etiqueta.slice(0, 400) })
      .where(eq(routePlanStops.id, stopId));
    if (!conocida) {
      await db.insert(geoCache).values({
        key: s.addressKey, query: u.consulta.slice(0, 400), lat: u.lat, lng: u.lng, quality: u.calidad, label: u.etiqueta.slice(0, 400), updatedBy: user.id,
      }).onConflictDoNothing();
    }
    return { ok: true, message: "Ubicada.", lat: u.lat, lng: u.lng, calidad: u.calidad, etiqueta: u.etiqueta };
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Corrige la ubicación de una parada (se arrastró el pin o se hizo clic en el mapa). Se
 * recuerda como MANUAL: la próxima programación con esa dirección ya sale aquí.
 */
export async function moverParada(stopId: string, lat: number, lng: number): Promise<ActionResult> {
  try {
    const user = await requireActionUser("trips.manage");
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !dentroDeLima(lat, lng)) {
      throw new BusinessError("Ese punto queda fuera de Lima.");
    }
    const [s] = await db.select().from(routePlanStops).where(eq(routePlanStops.id, stopId));
    if (!s) throw new BusinessError("La parada no existe.");
    await db.transaction(async (tx) => {
      await tx.update(routePlanStops).set({ lat, lng, geoQuality: "MANUAL", geoLabel: "Ubicada a mano en el mapa" })
        .where(eq(routePlanStops.id, stopId));
      await tx.insert(geoCache).values({ key: s.addressKey, query: s.cleanAddress, lat, lng, quality: "MANUAL", label: "Ubicada a mano en el mapa", updatedBy: user.id })
        .onConflictDoUpdate({ target: geoCache.key, set: { lat, lng, quality: "MANUAL", label: "Ubicada a mano en el mapa", updatedBy: user.id, updatedAt: new Date() } });
      // Las rutas calculadas ya no corresponden: hay que volver a calcular.
      await tx.update(routePlans).set({ status: "BORRADOR" }).where(eq(routePlans.id, s.planId));
      await logAudit({
        user, action: "EDITAR", module: "RUTAS", recordId: s.planId,
        description: `${user.name} ubicó a mano «${s.cleanAddress}» (${s.district}).`,
        oldData: { lat: s.lat, lng: s.lng, calidad: s.geoQuality }, newData: { lat, lng },
      }, tx);
    });
    return { ok: true, message: "Ubicación guardada. Se recordará para la próxima vez." };
  } catch (e) {
    return toActionError(e);
  }
}

/** Fija el centro de recojo o la cochera en el mapa. */
export async function guardarLugar(key: "CD" | "COCHERA", lat: number, lng: number, address: string): Promise<ActionResult> {
  try {
    const user = await requireActionUser("trips.manage");
    if (key !== "CD" && key !== "COCHERA") throw new BusinessError("Lugar inválido.");
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !dentroDeLima(lat, lng)) throw new BusinessError("Ese punto queda fuera de Lima.");
    const name = key === "CD" ? "Centro de recojo (Lurín)" : "Cochera";
    await db.insert(routePlaces).values({ key, name, address: address.trim().slice(0, 240) || null, lat, lng, updatedBy: user.id })
      .onConflictDoUpdate({ target: routePlaces.key, set: { lat, lng, address: address.trim().slice(0, 240) || null, updatedBy: user.id, updatedAt: new Date() } });
    await logAudit({
      user, action: "EDITAR", module: "RUTAS", recordId: key,
      description: `${user.name} ubicó ${key === "CD" ? "el centro de recojo" : "la cochera"} en el mapa${address.trim() ? ` (${address.trim()})` : ""}.`,
      newData: { lat, lng, address },
    });
    revalidatePath("/rutas", "layout");
    return { ok: true, message: `${name}: ubicación guardada.` };
  } catch (e) {
    return toActionError(e);
  }
}

/**
 * Calcula las rutas: reparte las paradas entre las móviles elegidas y ordena cada ruta para
 * hacer la menor cantidad de kilómetros. Cada móvil que sale hace cochera → centro de
 * recojo (a cargar) → sus entregas → cochera. Guarda el trazo por las calles para dibujarlo.
 */
export async function calcularRutas(planId: string, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireActionUser("trips.manage");
    const { moviles, errores } = leerMoviles(formData);
    const servicio = Number(String(formData.get("serviceMinutes") ?? "15"));
    if (!Number.isInteger(servicio) || servicio < 0 || servicio > 240) errores.serviceMinutes = "Entre 0 y 240 minutos";
    const jornadaTxt = String(formData.get("maxHours") ?? "").trim().replace(",", ".");
    const jornadaH = jornadaTxt ? Number(jornadaTxt) : null;
    if (jornadaH != null && (!Number.isFinite(jornadaH) || jornadaH <= 0 || jornadaH > 24)) errores.maxHours = "Jornada entre 1 y 24 horas";
    const cargaTxt = String(formData.get("loadMinutes") ?? "30").trim();
    const cargaMin = cargaTxt ? Number(cargaTxt) : 0;
    if (!Number.isInteger(cargaMin) || cargaMin < 0 || cargaMin > 300) errores.loadMinutes = "Carga entre 0 y 300 minutos";
    if (!moviles.length) return { ok: false, message: "Elige al menos una móvil.", fieldErrors: { moviles: "Elige al menos una móvil" } };
    if (Object.keys(errores).length) return { ok: false, message: "Revisa los campos marcados.", fieldErrors: errores };

    const [plan] = await db.select().from(routePlans).where(eq(routePlans.id, planId));
    if (!plan) throw new BusinessError("La programación no existe.");
    const { centro, cochera } = await lugares();
    if (!cochera) throw new BusinessError("Falta ubicar la cochera: márcala en el mapa con «Ubicar cochera».");

    const paradas = await db.select().from(routePlanStops).where(eq(routePlanStops.planId, planId));
    const sinUbicar = paradas.filter((p) => p.lat == null || p.lng == null);
    if (sinUbicar.length) {
      throw new BusinessError(`Faltan ubicar ${sinUbicar.length} parada(s) en el mapa: ${sinUbicar.slice(0, 3).map((p) => p.customer).join(", ")}${sinUbicar.length > 3 ? "…" : ""}.`);
    }

    const puntos = [centro, ...paradas.map((p) => ({ lat: p.lat!, lng: p.lng! })), cochera];
    const m = await matriz(puntos);
    const r = optimizar({
      distancias: m.distancias,
      duraciones: m.duraciones,
      servicioSeg: servicio * 60,
      // El tramo cochera → centro (índices: la cochera es la última fila de la matriz).
      salidaMetros: m.distancias[puntos.length - 1][0],
      salidaSegundos: m.duraciones[puntos.length - 1][0] + cargaMin * 60,
      // Salen todas las móviles marcadas: si no hace falta alguna, se desmarca.
      usarTodas: true,
      kg: [0, ...paradas.map((p) => Number(p.kg))],
      m3: [0, ...paradas.map((p) => Number(p.m3))],
      moviles: moviles.map((v) => ({
        capacidadKg: v.capacidadKg, capacidadM3: v.capacidadM3, maxParadas: v.maxParadas,
        maxSegundos: jornadaH != null ? jornadaH * 3600 : null,
      })),
    });

    // El trazo por las calles de cada móvil con paradas.
    const trazos = await Promise.all(r.rutas.map((ruta) => ruta.length
      ? trazo([cochera, centro, ...ruta.map((i) => puntos[i]), cochera])
      : Promise.resolve(null)));
    const aproximado = m.aproximada || trazos.some((t) => t?.aproximado);

    let totalKm = 0;
    await db.transaction(async (tx) => {
      await tx.update(routePlanStops).set({ planVehicleId: null, sequence: null }).where(eq(routePlanStops.planId, planId));
      await tx.delete(routePlanVehicles).where(eq(routePlanVehicles.planId, planId));
      for (let v = 0; v < moviles.length; v++) {
        const ruta = r.rutas[v];
        const t = trazos[v];
        const km = t ? t.metros / 1000 : 0;
        totalKm += km;
        const cargaKg = ruta.reduce((s, i) => s + Number(paradas[i - 1].kg), 0);
        const cargaM3 = ruta.reduce((s, i) => s + Number(paradas[i - 1].m3), 0);
        const [fila] = await tx.insert(routePlanVehicles).values({
          planId, vehicleId: moviles[v].vehicleId, plate: moviles[v].plate, position: v,
          capacityKg: moviles[v].capacidadKg?.toFixed(2) ?? null, capacityM3: moviles[v].capacidadM3?.toFixed(3) ?? null,
          maxStops: moviles[v].maxParadas,
          km: ruta.length ? km.toFixed(2) : null,
          minutes: ruta.length ? Math.round((t!.segundos / 60) + cargaMin + servicio * ruta.length) : null,
          loadKg: cargaKg.toFixed(2), loadM3: cargaM3.toFixed(4),
          geometry: t?.linea ?? null,
        }).returning({ id: routePlanVehicles.id });
        for (let k = 0; k < ruta.length; k++) {
          await tx.update(routePlanStops).set({ planVehicleId: fila.id, sequence: k + 1 })
            .where(and(eq(routePlanStops.id, paradas[ruta[k] - 1].id), eq(routePlanStops.planId, planId)));
        }
      }
      await tx.update(routePlans).set({
        status: "CALCULADA", totalKm: totalKm.toFixed(2), approximate: aproximado, serviceMinutes: servicio, calculatedAt: new Date(),
      }).where(eq(routePlans.id, planId));
      await logAudit({
        user, action: "EDITAR", module: "RUTAS", recordId: planId,
        description: `${user.name} calculó las rutas del ${formatDate(plan.serviceDate)}: ${moviles.length} móvil(es), `
          + `${totalKm.toFixed(1)} km${r.sinAsignar.length ? `, ${r.sinAsignar.length} parada(s) sin móvil` : ""}.`,
        newData: { moviles: moviles.map((v) => v.plate), km: totalKm, aproximado },
      }, tx);
    });

    revalidatePath(`/rutas/${planId}`);
    revalidatePath("/rutas");
    const usadas = r.rutas.filter((x) => x.length).length;
    return {
      ok: true,
      message: r.sinAsignar.length
        ? `Rutas calculadas, pero ${r.sinAsignar.length} parada(s) no entran en las móviles elegidas (por capacidad o jornada): agrega otra móvil o amplía la capacidad o la jornada.`
        : `Rutas calculadas: ${usadas} móvil(es), ${totalKm.toFixed(1)} km en total${aproximado ? " (aproximado)" : ""}.`,
    };
  } catch (e) {
    return toActionError(e);
  }
}

export async function eliminarPlan(planId: string): Promise<ActionResult> {
  const r = await borrarPlan(planId);
  // Borrada, su página ya no existe: se vuelve a la lista.
  if (r.ok) redirect("/rutas");
  return r;
}

async function borrarPlan(planId: string): Promise<ActionResult> {
  try {
    const user = await requireActionUser("trips.manage");
    const [plan] = await db.delete(routePlans).where(eq(routePlans.id, planId)).returning();
    if (!plan) throw new BusinessError("La programación no existe.");
    await logAudit({
      user, action: "ELIMINAR", module: "RUTAS", recordId: planId,
      description: `${user.name} eliminó la programación del ${formatDate(plan.serviceDate)} (${plan.fileName ?? "sin archivo"}).`,
      oldData: plan,
    });
    revalidatePath("/rutas");
    return { ok: true, message: "Programación eliminada." };
  } catch (e) {
    return toActionError(e);
  }
}
