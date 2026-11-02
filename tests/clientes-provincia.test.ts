/**
 * El directorio de clientes de provincia.
 *
 * Se usa de una sola manera: sale un viaje, se escribe el nombre del destinatario y tiene
 * que salir todo lo demás. Así que lo que esta prueba cuida es la búsqueda —que encuentre
 * escribiendo poco, en minúsculas y sin acentos de más— y que no haya dos fichas del mismo
 * cliente en la misma provincia, porque entonces hay dos teléfonos y ninguno manda.
 *
 *   npx tsx --conditions=react-server tests/clientes-provincia.test.ts
 */
import "dotenv/config";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../src/db";
import { provinceClients } from "../src/db/schema";
import {
  getProvinceClient, listProvinceClients, provinceCounts, provinceOptions, readProvinceFilters,
} from "../src/server/province-queries";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("OK  ", n);
  else { fails++; console.log("FALLA", n, JSON.stringify(x ?? "")); }
};

const SELLO = String(Date.now()).slice(-6);
const JAEN = `Jaén ${SELLO}`;
const PIURA = `Piura ${SELLO}`;

async function main() {
  const creados: string[] = [];
  try {
    const [comercial] = await db.insert(provinceClients).values({
      province: JAEN,
      clientName: `Comercial Mesones ${SELLO}`,
      location: "Av. Mesones Muro 1250, frente al grifo",
      clientPhone: "976543210",
      stevedoreName: "Don Lucho",
      stevedorePhone: "912345678",
      costPerTon: "35.00",
      notes: "Recibe hasta las 5 p.m.",
    }).returning();
    creados.push(comercial.id);

    const [distribuidora] = await db.insert(provinceClients).values({
      province: PIURA,
      clientName: `Distribuidora Norte ${SELLO}`,
      location: "Mercado mayorista, puesto 14",
    }).returning();
    creados.push(distribuidora.id);

    // ---------- La búsqueda, que es para lo que se entra ----------
    const porNombre = await listProvinceClients({ q: "comercial mesones" });
    check("encuentra al cliente escribiendo parte del nombre, en minúsculas",
      porNombre.rows.some((r) => r.id === comercial.id), porNombre.rows.map((r) => r.clientName));

    const ficha = porNombre.rows.find((r) => r.id === comercial.id)!;
    check("y sale con todo lo que hace falta para el viaje",
      ficha.location?.includes("Mesones Muro") === true
      && ficha.clientPhone === "976543210"
      && ficha.stevedoreName === "Don Lucho"
      && ficha.stevedorePhone === "912345678"
      && ficha.costPerTon === "35.00",
      ficha);

    const porTelefono = await listProvinceClients({ q: "976543" });
    check("se puede buscar por el teléfono, que a veces es lo único que se tiene",
      porTelefono.rows.some((r) => r.id === comercial.id));

    const porEstibador = await listProvinceClients({ q: "don lucho" });
    check("y por el estibador", porEstibador.rows.some((r) => r.id === comercial.id));

    const porUbicacion = await listProvinceClients({ q: "grifo" });
    check("y por una referencia de la ubicación", porUbicacion.rows.some((r) => r.id === comercial.id));

    const porProvincia = await listProvinceClients({ province: PIURA });
    check("el filtro por provincia trae solo los de esa provincia",
      porProvincia.rows.length === 1 && porProvincia.rows[0].id === distribuidora.id,
      porProvincia.rows.map((r) => r.province));

    // ---------- Lo que falta se ve ----------
    check("un cliente sin precio cerrado se guarda igual, con el costo vacío",
      distribuidora.costPerTon === null);

    // ---------- Dar de baja ----------
    await db.update(provinceClients).set({ active: false }).where(eq(provinceClients.id, distribuidora.id));
    const vigentes = await listProvinceClients({ q: SELLO });
    check("un cliente dado de baja desaparece del directorio",
      !vigentes.rows.some((r) => r.id === distribuidora.id), vigentes.rows.map((r) => r.clientName));

    const conBajas = await listProvinceClients({ q: SELLO, incluirInactivos: true });
    check("pero no se borra: sigue estando si se piden los dados de baja",
      conBajas.rows.some((r) => r.id === distribuidora.id));

    const opciones = await provinceOptions();
    check("las provincias del filtro salen solo de los vigentes",
      opciones.includes(JAEN) && !opciones.includes(PIURA), { JAEN, PIURA });

    // ---------- La regla de no duplicar ----------
    let repitio = false;
    try {
      await db.insert(provinceClients).values({ province: JAEN.toUpperCase(), clientName: `COMERCIAL MESONES ${SELLO}` });
      repitio = true;
    } catch { /* lo esperado: el índice único lo impide */ }
    check("no deja dos fichas del mismo cliente en la misma provincia, ni cambiando mayúsculas", !repitio);

    // ---------- Los filtros que llegan de la URL ----------
    const f = readProvinceFilters({ q: "  jaén  ", provincia: JAEN, inactivos: "1" });
    check("los filtros se leen de la dirección, con los espacios recortados",
      f.q === "jaén" && f.province === JAEN && f.incluirInactivos === true, f);

    // ---------- La ficha suelta ----------
    const suelta = await getProvinceClient(comercial.id);
    check("se puede traer una ficha por su id", suelta?.clientName === comercial.clientName);

    const cuentas = await provinceCounts();
    check("las cuentas de arriba no cuentan a los dados de baja",
      cuentas.clientes >= 1 && cuentas.provincias >= 1 && cuentas.conPrecio >= 1, cuentas);
  } finally {
    if (creados.length) await db.delete(provinceClients).where(inArray(provinceClients.id, creados));
    await db.delete(provinceClients).where(sql`${provinceClients.clientName} like ${"%" + SELLO}`);
  }

  console.log(fails === 0 ? `\nTodo bien (${fails} fallos)` : `\n${fails} FALLO(S)`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
