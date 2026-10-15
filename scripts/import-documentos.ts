/**
 * Carga de una vez los documentos de la flota desde una carpeta.
 *
 * Espera la estructura que ya usa la empresa: una subcarpeta por placa, y dentro los PDF.
 *
 *     Nueva carpeta/
 *       BJA-838/
 *         CERTIFICADO_SOAT_BJA838.pdf
 *         TARJETA DE PROPIEDAD.pdf
 *         REVISION TECNICA.pdf
 *       CDN-786/
 *         ...
 *
 * El tipo de documento sale del nombre del archivo. Lo que no reconoce lo guarda igual,
 * como "Otro documento del vehículo": es preferible tenerlo cargado y reclasificarlo
 * después desde la web que dejarlo fuera y que nadie se acuerde.
 *
 * NO pone fechas de vencimiento: están dentro del PDF y adivinarlas sería inventar datos.
 * Al terminar, el script dice cuáles conviene completar a mano desde la web.
 *
 * Uso:
 *     npm run import:documentos -- "C:\\ruta\\Nueva carpeta" --simular
 *     npm run import:documentos -- "C:\\ruta\\Nueva carpeta"
 *
 * Es seguro repetirlo: un archivo que ya está cargado para esa placa se salta.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "../src/db";
import { documents, vehicles } from "../src/db/schema";
import { DOCUMENT_KIND_LABEL, documentKindFromFilename, normalizePlate } from "../src/lib/utils";
import { describeDriver, maxBytesFor, putFile, safeName } from "../src/server/storage";

const SIMULAR = process.argv.includes("--simular");
const CARPETA = process.argv.find((a) => !a.startsWith("--") && !a.endsWith(".ts") && !a.includes("node"));

const EXTENSIONES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

async function main() {
  if (!CARPETA || !fs.existsSync(CARPETA)) {
    console.error("Indica la carpeta que tiene una subcarpeta por placa.");
    console.error('   npm run import:documentos -- "C:\\\\ruta\\\\Nueva carpeta" --simular');
    process.exit(1);
  }

  const placas = fs.readdirSync(CARPETA, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  if (placas.length === 0) {
    console.error(`No hay ninguna subcarpeta dentro de ${CARPETA}.`);
    process.exit(1);
  }

  console.log(`${placas.length} carpeta(s) de placa encontradas en ${CARPETA}`);
  if (SIMULAR) console.log("\n--- SIMULACIÓN: no se guarda nada ---\n");

  const resumen = { vehiculos: 0, nuevos: 0, repetidos: 0, saltados: 0 };
  const sinFecha: string[] = [];
  const fallidos: string[] = [];

  // Con el almacén en la propia base, el límite por archivo es bajo. Conviene saberlo
  // antes de empezar y no cuando falla el archivo número cuarenta.
  const limite = maxBytesFor();
  console.log(`Almacén: ${describeDriver()} · máximo ${(limite / 1024 / 1024).toFixed(0)} MB por archivo`);

  for (const carpeta of placas.sort()) {
    const plate = normalizePlate(carpeta);
    if (!plate || plate.length < 6) {
      console.log(`  ${carpeta}: no parece una placa, se salta`);
      continue;
    }

    // El vehículo se crea si no estaba; si ya existe se reutiliza, para poder repetir la
    // carga sin terminar con la misma unidad duplicada.
    let [vehiculo] = await db.select().from(vehicles).where(eq(vehicles.plate, plate)).limit(1);
    if (!vehiculo && !SIMULAR) {
      [vehiculo] = await db.insert(vehicles).values({ plate }).returning();
      resumen.vehiculos++;
    } else if (!vehiculo) {
      resumen.vehiculos++;
    }

    const archivos = fs.readdirSync(path.join(CARPETA, carpeta), { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name)
      // desktop.ini y compañía: los crea Windows y no son documentos de nadie.
      .filter((n) => EXTENSIONES[path.extname(n).toLowerCase()]);

    console.log(`\n${plate} — ${archivos.length} archivo(s)`);

    for (const archivo of archivos.sort()) {
      const kind = documentKindFromFilename(archivo);
      const etiqueta = DOCUMENT_KIND_LABEL[kind] ?? kind;

      if (vehiculo) {
        const [yaEsta] = await db.select({ id: documents.id }).from(documents)
          .where(and(eq(documents.vehicleId, vehiculo.id), eq(documents.filename, archivo)))
          .limit(1);
        if (yaEsta) {
          console.log(`   = ${archivo} — ya estaba cargado`);
          resumen.repetidos++;
          continue;
        }
      }

      const ruta = path.join(CARPETA, carpeta, archivo);
      const datos = fs.readFileSync(ruta);
      const contentType = EXTENSIONES[path.extname(archivo).toLowerCase()];

      // Un archivo demasiado grande no puede tumbar la carga entera: se anota y se sigue.
      // Perder cincuenta documentos por culpa de uno sería lo peor que podría pasar aquí.
      if (datos.byteLength > limite) {
        console.log(`   ! ${archivo} — pesa ${(datos.byteLength / 1024 / 1024).toFixed(1)} MB y no entra`);
        fallidos.push(`${plate} · ${archivo} (${(datos.byteLength / 1024 / 1024).toFixed(1)} MB)`);
        resumen.saltados++;
        continue;
      }

      console.log(`   + ${archivo} → ${etiqueta} (${(datos.byteLength / 1024).toFixed(0)} KB)`);
      if (kind === "SOAT" || kind === "REVISION_TECNICA") sinFecha.push(`${plate} · ${etiqueta}`);

      if (SIMULAR || !vehiculo) { resumen.nuevos++; continue; }

      try {
        const key = `documentos/${new Date().getFullYear()}/${crypto.randomUUID()}-${safeName(archivo)}`;
        const guardado = await putFile({ key, data: datos, contentType });
        await db.insert(documents).values({
          vehicleId: vehiculo.id,
          kind,
          title: null,
          filename: archivo.slice(0, 250),
          contentType,
          sizeBytes: datos.byteLength,
          storageDriver: guardado.storageDriver,
          storageKey: guardado.storageKey,
          content: guardado.content,
        });
        resumen.nuevos++;
      } catch (e) {
        const razon = e instanceof Error ? e.message : String(e);
        console.log(`   ! ${archivo} — ${razon}`);
        fallidos.push(`${plate} · ${archivo}: ${razon}`);
        resumen.saltados++;
      }
    }
  }

  console.log("\n" + "─".repeat(60));
  console.log(`Vehículos nuevos:     ${resumen.vehiculos}`);
  console.log(`Documentos cargados:  ${resumen.nuevos}`);
  console.log(`Ya estaban:           ${resumen.repetidos}`);
  if (resumen.saltados > 0) console.log(`No se pudieron cargar: ${resumen.saltados}`);

  if (fallidos.length > 0) {
    console.log(`\nEstos ${fallidos.length} quedaron fuera:\n`);
    for (const f of fallidos) console.log(`   · ${f}`);
    console.log(`\nSi es por el tamaño, hay dos salidas: configurar Vercel Blob en el`);
    console.log(`proyecto —sube el límite a 15 MB y es gratis— o volver a escanear esos`);
    console.log(`archivos en menor calidad. Mientras tanto, el resto sí quedó cargado.`);
  }

  if (sinFecha.length > 0) {
    console.log(`\nEstos ${sinFecha.length} caducan y quedaron SIN fecha de vencimiento.`);
    console.log("Mientras no se complete, nadie se va a enterar cuando venzan.");
    console.log("Se completan desde la web, en Documentos → el lápiz de cada uno:\n");
    for (const f of sinFecha.slice(0, 40)) console.log(`   · ${f}`);
    if (sinFecha.length > 40) console.log(`   … y ${sinFecha.length - 40} más`);
  }

  if (SIMULAR) console.log("\nFue una simulación: no se guardó nada.");
  process.exit(0);
}

main().catch((e) => {
  console.error("\nFALLÓ:", e instanceof Error ? e.message : e);
  process.exit(1);
});
