/**
 * Carga la ficha de la flota desde el Excel de mantenimiento.
 *
 * Lee la hoja "INFORMACIÓN GENERAL" del archivo que ya mantiene la empresa y completa, de
 * cada placa: marca, modelo, año, capacidad en TN y en m³, código MTC y si tiene GPS. De
 * las fechas que trae —SOAT y revisión técnica— crea o completa el documento
 * correspondiente, para que el sistema avise cuando venzan.
 *
 * Las fechas se cargan AUNQUE no esté el PDF. Un SOAT con fecha y sin archivo ya sirve
 * para avisar que vence; esperar a tener el papel escaneado es lo que hace que se venza sin
 * que nadie se dé cuenta. El archivo se sube después y se junta con la fecha que ya está.
 *
 * Lo que está debajo de "CAMIONES VENDIDOS" se carga igual, pero dado de baja: sus papeles
 * son el respaldo de lo que circuló y no se tiran, pero la unidad ya no es de la flota.
 *
 * Uso:
 *     npm run import:flota -- "C:\\ruta\\MANTENIMIENTO_TRANSJER.xlsx" --simular
 *     npm run import:flota -- "C:\\ruta\\MANTENIMIENTO_TRANSJER.xlsx"
 *
 * Es seguro repetirlo: no duplica unidades ni documentos, y NUNCA borra un dato que ya
 * esté puesto para dejarlo en blanco — si en el Excel falta una celda, lo que hay en el
 * sistema se queda.
 */
import "dotenv/config";
import fs from "node:fs";
import ExcelJS from "exceljs";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import { documents, vehicles } from "../src/db/schema";
import { normalizePlate } from "../src/lib/utils";

const SIMULAR = process.argv.includes("--simular");
const ARCHIVO = process.argv.slice(2).find((a) => a.toLowerCase().endsWith(".xlsx"));

/** Quita acentos y espacios de sobra: los encabezados del Excel cambian de un año a otro. */
function normalizar(v: unknown): string {
  return String(v ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/** El texto de una celda, ya sea texto, número, fórmula o texto enriquecido. */
function texto(celda: ExcelJS.Cell | undefined): string {
  if (!celda) return "";
  const v = celda.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ("text" in v && typeof v.text === "string") return v.text.trim();
    if ("result" in v) return String(v.result ?? "").trim();
    if ("richText" in v) return v.richText.map((r) => r.text).join("").trim();
    return "";
  }
  return String(v).trim();
}

/**
 * Una fecha de una celda, en formato AAAA-MM-DD.
 *
 * El Excel mezcla fechas de verdad con fechas escritas a mano ("30/06/2027", "30-06-27") y
 * con celdas que dicen "NO TIENE". Lo que no sea una fecha se devuelve como nada: inventar
 * un vencimiento es peor que no tenerlo, porque el aviso saltaría el día equivocado.
 */
function fecha(celda: ExcelJS.Cell | undefined): string | null {
  if (!celda) return null;
  const v = celda.value;

  if (v instanceof Date) {
    // Las fechas de Excel llegan en UTC; tomarlas en local correría un día hacia atrás.
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "number") {
    // Serial de Excel: días desde el 30/12/1899.
    if (v < 20000 || v > 80000) return null;
    const ms = Date.UTC(1899, 11, 30) + v * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }

  const t = texto(celda);
  const m = t.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    const [, d, mes, a] = m;
    const anio = a.length === 2 ? 2000 + Number(a) : Number(a);
    const iso = `${anio}-${mes.padStart(2, "0")}-${d.padStart(2, "0")}`;
    return valida(iso) ? iso : null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return valida(t) ? t : null;
  return null;
}

/** Que la fecha exista de verdad: 31/02 se escribe sin problema y no es un día. */
function valida(iso: string): boolean {
  const [a, m, d] = iso.split("-").map(Number);
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

/** Un número de una celda, o nada si está vacía o no es un número. */
function numero(celda: ExcelJS.Cell | undefined): number | null {
  const t = texto(celda).replace(/,/g, ".").replace(/[^\d.\-]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** "SI", "X", "SÍ" → true; "NO", vacío → false. */
function siNo(celda: ExcelJS.Cell | undefined): boolean {
  const t = normalizar(texto(celda));
  return t === "SI" || t === "X" || t === "SI TIENE" || t === "TRUE";
}

/**
 * Qué columna es cada cosa, buscando palabras en el encabezado.
 *
 * Se busca por palabra y no por posición porque el Excel se edita a mano: basta que
 * alguien inserte una columna para que un mapeo por número cargue el año en la capacidad.
 */
const COLUMNAS: { clave: string; busca: (h: string) => boolean }[] = [
  { clave: "placa", busca: (h) => h === "PLACA" || h.startsWith("PLACA") },
  { clave: "empresa", busca: (h) => h.startsWith("EMPRESA") },
  { clave: "marca", busca: (h) => h.startsWith("MARCA") },
  { clave: "modelo", busca: (h) => h.startsWith("MODELO") },
  { clave: "anio", busca: (h) => h === "ANO" || h === "ANIO" || h.startsWith("ANO ") },
  { clave: "tn", busca: (h) => h === "TN" || h.includes("TONELADA") },
  { clave: "m3", busca: (h) => h === "M3" || h.includes("M3") },
  // El SOAT trae fecha; la revisión técnica, fecha y a veces el taller (MTP).
  { clave: "soat", busca: (h) => h.includes("SOAT") && !h.includes("COSTO") },
  { clave: "revision", busca: (h) => h.includes("REVISION") && !h.includes("MTP") && !h.includes("MTC") },
  { clave: "mtcSiNo", busca: (h) => h.includes("MTC") },
  { clave: "constancia", busca: (h) => h.includes("CONSTANCIA") },
  { clave: "tarjeta", busca: (h) => h.includes("TARJETA") },
  { clave: "gps", busca: (h) => h.includes("GPS") },
];

type Mapa = Partial<Record<string, number>>;

/** Encuentra la fila de encabezados y en qué columna está cada dato. */
function encabezados(hoja: ExcelJS.Worksheet): { fila: number; mapa: Mapa } | null {
  for (let i = 1; i <= Math.min(hoja.rowCount, 20); i++) {
    const fila = hoja.getRow(i);
    const celdas: string[] = [];
    fila.eachCell({ includeEmpty: true }, (c, n) => { celdas[n] = normalizar(texto(c)); });
    if (!celdas.some((h) => h === "PLACA")) continue;

    const mapa: Mapa = {};
    for (let n = 1; n < celdas.length; n++) {
      const h = celdas[n];
      if (!h) continue;
      for (const { clave, busca } of COLUMNAS) {
        if (mapa[clave] === undefined && busca(h)) { mapa[clave] = n; break; }
      }
    }
    return { fila: i, mapa };
  }
  return null;
}

type Unidad = {
  plate: string;
  empresa: string | null;
  brand: string | null;
  model: string | null;
  year: number | null;
  capacityTn: number | null;
  capacityM3: number | null;
  mtcCode: string | null;
  hasGps: boolean;
  soat: string | null;
  revision: string | null;
  vendido: boolean;
};

/** La hoja leída: una entrada por placa, con la marca de "vendido" ya aplicada. */
function leerHoja(hoja: ExcelJS.Worksheet): Unidad[] {
  const cab = encabezados(hoja);
  if (!cab) throw new Error(`La hoja "${hoja.name}" no tiene una columna PLACA.`);

  const unidades: Unidad[] = [];
  let vendidos = false;

  for (let i = cab.fila + 1; i <= hoja.rowCount; i++) {
    const fila = hoja.getRow(i);
    const en = (clave: string) => (cab.mapa[clave] ? fila.getCell(cab.mapa[clave]!) : undefined);

    // Un rótulo suelto en cualquier columna cambia el bloque: a partir de ahí, las
    // unidades están vendidas.
    const todaLaFila = normalizar(
      (fila.values as unknown[] ?? []).map((v) => (typeof v === "object" ? texto({ value: v } as ExcelJS.Cell) : v)).join(" "),
    );
    if (todaLaFila.includes("VENDIDO")) { vendidos = true; continue; }

    const bruta = texto(en("placa"));
    if (!bruta) continue;
    const plate = normalizePlate(bruta);
    // Las placas peruanas tienen seis caracteres más el guion. Lo que no da la talla es
    // un subtotal, una nota al pie o una fila de separación.
    if (!/^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(plate)) continue;

    unidades.push({
      plate,
      empresa: texto(en("empresa")) || null,
      brand: texto(en("marca")) || null,
      model: texto(en("modelo")) || null,
      year: (() => { const n = numero(en("anio")); return n && n >= 1970 && n <= 2100 ? Math.trunc(n) : null; })(),
      capacityTn: numero(en("tn")),
      capacityM3: numero(en("m3")),
      // La constancia MTC trae el número; la columna MTC solo dice si la tiene.
      mtcCode: (() => {
        const c = texto(en("constancia"));
        if (c && !/^(SI|NO|X)$/i.test(c)) return c.slice(0, 40);
        return null;
      })(),
      hasGps: siNo(en("gps")),
      soat: fecha(en("soat")),
      revision: fecha(en("revision")),
      vendido: vendidos,
    });
  }

  return unidades;
}

/**
 * Pone la fecha en el documento de ese tipo, o lo crea sin archivo si no existe.
 *
 * Si ya hay un documento de ese tipo, se le completa la fecha; no se crea otro. Dos SOAT
 * para la misma unidad, uno con archivo y otro con fecha, es justo lo que hace que después
 * nadie sepa cuál es el bueno.
 */
async function fijarFecha(vehicleId: string, kind: string, expiresAt: string) {
  const [existente] = await db.select({ id: documents.id, expiresAt: documents.expiresAt })
    .from(documents)
    .where(and(eq(documents.vehicleId, vehicleId), eq(documents.kind, kind)))
    .orderBy(documents.createdAt)
    .limit(1);

  if (!existente) {
    await db.insert(documents).values({ vehicleId, kind, expiresAt });
    return "creado";
  }
  if (existente.expiresAt === expiresAt) return "igual";
  if (existente.expiresAt && existente.expiresAt > expiresAt) {
    // Lo que hay en el sistema vence más tarde que lo del Excel: el Excel está viejo y
    // escribirlo encima haría "caducar" un papel que ya se renovó.
    return "mas-nuevo";
  }
  await db.update(documents).set({ expiresAt, updatedAt: new Date() })
    .where(eq(documents.id, existente.id));
  return "actualizado";
}

async function main() {
  if (!ARCHIVO || !fs.existsSync(ARCHIVO)) {
    console.error("Indica el Excel de mantenimiento (.xlsx).");
    console.error('   npm run import:flota -- "C:\\\\ruta\\\\MANTENIMIENTO_TRANSJER.xlsx" --simular');
    process.exit(1);
  }

  const libro = new ExcelJS.Workbook();
  await libro.xlsx.readFile(ARCHIVO);

  // La hoja de la ficha. Si el nombre cambió, se usa la primera que tenga una columna PLACA.
  const hoja = libro.worksheets.find((h) => normalizar(h.name).includes("INFORMACION"))
    ?? libro.worksheets.find((h) => { try { return !!encabezados(h); } catch { return false; } });
  if (!hoja) {
    console.error("No encontré ninguna hoja con la ficha de los vehículos (columna PLACA).");
    process.exit(1);
  }

  console.log(`Hoja: "${hoja.name}" de ${ARCHIVO}`);
  const unidades = leerHoja(hoja);
  if (unidades.length === 0) {
    console.error("No leí ninguna placa. Revisa que la hoja tenga la columna PLACA y las filas debajo.");
    process.exit(1);
  }

  const activas = unidades.filter((u) => !u.vendido).length;
  console.log(`${unidades.length} placa(s): ${activas} en flota y ${unidades.length - activas} vendida(s)`);
  if (SIMULAR) console.log("\n--- SIMULACIÓN: no se guarda nada ---\n");

  const resumen = { nuevos: 0, actualizados: 0, fechas: 0, fechasCreadas: 0, deBaja: 0 };
  const sinFecha: string[] = [];
  const masNuevo: string[] = [];

  for (const u of unidades) {
    const [existe] = await db.select().from(vehicles).where(eq(vehicles.plate, u.plate)).limit(1);

    // Nunca se escribe un blanco encima de un dato que ya está: el Excel puede tener la
    // celda vacía y el sistema el dato bueno, cargado a mano desde la web.
    const campos = {
      brand: u.brand ?? existe?.brand ?? null,
      model: u.model ?? existe?.model ?? null,
      year: u.year ?? existe?.year ?? null,
      capacityTn: u.capacityTn !== null ? String(u.capacityTn) : existe?.capacityTn ?? null,
      capacityM3: u.capacityM3 !== null ? String(u.capacityM3) : existe?.capacityM3 ?? null,
      mtcCode: u.mtcCode ?? existe?.mtcCode ?? null,
      hasGps: u.hasGps || (existe?.hasGps ?? false),
      description: existe?.description ?? ([u.brand, u.model].filter(Boolean).join(" ") || null),
      notes: existe?.notes ?? (u.empresa ? `Titular según el Excel de mantenimiento: ${u.empresa}` : null),
      active: u.vendido ? false : existe?.active ?? true,
    };

    const ficha = [u.brand, u.model, u.year].filter(Boolean).join(" ") || "sin datos";
    const marca = u.vendido ? " [VENDIDO → de baja]" : "";
    console.log(`\n${u.plate} — ${ficha}${marca}`);
    if (u.capacityTn) console.log(`   ${u.capacityTn} TN${u.capacityM3 ? ` · ${u.capacityM3} m³` : ""}${u.hasGps ? " · GPS" : ""}`);
    if (u.mtcCode) console.log(`   Constancia MTC ${u.mtcCode}`);

    let vehicleId = existe?.id;
    if (!SIMULAR) {
      if (existe) {
        await db.update(vehicles).set({ ...campos, updatedAt: new Date() }).where(eq(vehicles.id, existe.id));
        resumen.actualizados++;
      } else {
        const [creado] = await db.insert(vehicles).values({ plate: u.plate, ...campos }).returning();
        vehicleId = creado.id;
        resumen.nuevos++;
      }
      if (u.vendido && existe?.active !== false) resumen.deBaja++;
    } else {
      if (existe) resumen.actualizados++;
      else resumen.nuevos++;
    }

    for (const [kind, etiqueta, valor] of [
      ["SOAT", "SOAT", u.soat],
      ["REVISION_TECNICA", "Revisión técnica", u.revision],
    ] as const) {
      if (!valor) {
        sinFecha.push(`${u.plate} · ${etiqueta}`);
        continue;
      }
      if (SIMULAR || !vehicleId) {
        console.log(`   ${etiqueta}: vence el ${valor}`);
        resumen.fechas++;
        continue;
      }
      const que = await fijarFecha(vehicleId, kind, valor);
      if (que === "mas-nuevo") {
        console.log(`   ${etiqueta}: el sistema ya tiene una fecha posterior, se respeta`);
        masNuevo.push(`${u.plate} · ${etiqueta}`);
      } else {
        console.log(`   ${etiqueta}: vence el ${valor} (${que})`);
        if (que === "creado") resumen.fechasCreadas++;
        if (que !== "igual") resumen.fechas++;
      }
    }
  }

  console.log("\n" + "─".repeat(60));
  console.log(`Unidades nuevas:        ${resumen.nuevos}`);
  console.log(`Unidades actualizadas:  ${resumen.actualizados}`);
  if (resumen.deBaja > 0) console.log(`Dadas de baja (vendidas): ${resumen.deBaja}`);
  console.log(`Fechas de vencimiento:  ${resumen.fechas}`);
  if (resumen.fechasCreadas > 0) {
    console.log(`   de ellas, ${resumen.fechasCreadas} quedaron como documento sin archivo:`);
    console.log(`   el aviso de vencimiento ya funciona; el PDF se sube cuando se tenga.`);
  }

  if (masNuevo.length > 0) {
    console.log(`\nEn ${masNuevo.length} caso(s) el sistema tenía una fecha POSTERIOR a la del Excel`);
    console.log("y se dejó como estaba (el Excel está desactualizado):\n");
    for (const f of masNuevo.slice(0, 20)) console.log(`   · ${f}`);
  }

  if (sinFecha.length > 0) {
    console.log(`\nEstos ${sinFecha.length} no traían fecha en el Excel y quedaron sin vencimiento.`);
    console.log("Se completan desde la web, en Documentos → la unidad → el lápiz:\n");
    for (const f of sinFecha.slice(0, 30)) console.log(`   · ${f}`);
    if (sinFecha.length > 30) console.log(`   … y ${sinFecha.length - 30} más`);
  }

  console.log("\nEl conductor de cada unidad NO está en el Excel: se asigna desde la web,");
  console.log("en Documentos → la unidad → Editar → Conductor asignado.");

  if (SIMULAR) console.log("\nFue una simulación: no se guardó nada.");
  process.exit(0);
}

main().catch((e) => {
  console.error("\nFALLÓ:", e instanceof Error ? e.message : e);
  process.exit(1);
});
