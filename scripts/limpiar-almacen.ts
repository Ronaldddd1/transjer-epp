/**
 * Deja el almacén vacío para empezar a cargarlo de cero.
 *
 * Borra TODO lo del módulo de EPP —entregas, devoluciones, movimientos, productos y
 * categorías— y NO toca a los trabajadores ni sus documentos, ni las facturas, ni las
 * obligaciones, ni los usuarios.
 *
 * Esto no se puede deshacer, así que el script hace dos cosas antes de borrar:
 *
 *   1. Guarda un respaldo en CSV de todo lo que va a eliminar, en una carpeta con la
 *      fecha y la hora. Si mañana hace falta un dato de lo que había, está ahí.
 *   2. Muestra el recuento y exige escribir --confirmar. Sin esa palabra no borra nada.
 *
 * Uso:
 *     npm run db:limpiar-almacen                 (solo mira y respalda: no borra)
 *     npm run db:limpiar-almacen -- --confirmar  (borra de verdad)
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const CONFIRMAR = process.argv.includes("--confirmar");

/** Las tablas que se vacían, en el orden en que se pueden borrar sin romper referencias. */
const TABLAS = [
  { nombre: "epp_returns", etiqueta: "devoluciones" },
  { nombre: "epp_deliveries", etiqueta: "entregas" },
  { nombre: "inventory_movements", etiqueta: "movimientos" },
  { nombre: "products", etiqueta: "productos" },
  { nombre: "categories", etiqueta: "categorías" },
] as const;

/** Una celda de CSV: comillas dobles y saltos de línea escapados como manda el formato. */
function celda(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  const texto = valor instanceof Date ? valor.toISOString() : String(valor);
  return /[",\n;]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

async function main() {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("Define DATABASE_URL en tu archivo .env");
  const sql = postgres(url, { max: 1, onnotice: () => {} });

  const sello = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const carpeta = path.join(process.cwd(), "respaldos", `almacen-${sello}`);
  fs.mkdirSync(carpeta, { recursive: true });

  console.log(`Respaldo en: ${carpeta}\n`);

  const resumen: { etiqueta: string; filas: number }[] = [];

  for (const tabla of TABLAS) {
    const filas = await sql`select * from ${sql(tabla.nombre)}`;
    resumen.push({ etiqueta: tabla.etiqueta, filas: filas.length });

    if (filas.length > 0) {
      const columnas = Object.keys(filas[0]);
      const lineas = [
        columnas.join(","),
        ...filas.map((f) => columnas.map((c) => celda((f as Record<string, unknown>)[c])).join(",")),
      ];
      fs.writeFileSync(path.join(carpeta, `${tabla.nombre}.csv`), `${lineas.join("\n")}\n`, "utf8");
    }
    console.log(`   ${String(filas.length).padStart(6)} ${tabla.etiqueta}`);
  }

  const [{ count: trabajadores }] = await sql`select count(*)::int from employees`;
  const [{ count: documentos }] = await sql`select count(*)::int from documents`;
  console.log(`\nNo se tocan: ${trabajadores} trabajador(es) y ${documentos} documento(s).`);
  console.log("Tampoco las facturas, las obligaciones ni los usuarios.");

  if (!CONFIRMAR) {
    console.log("\n─────────────────────────────────────────────");
    console.log("No se borró nada. El respaldo ya quedó guardado.");
    console.log("Para borrar de verdad, vuelve a correrlo así:\n");
    console.log("   npm run db:limpiar-almacen -- --confirmar\n");
    await sql.end();
    process.exit(0);
  }

  // Todo en una sola transacción: o queda vacío entero, o no se toca nada. A medias
  // quedarían entregas apuntando a productos que ya no existen.
  await sql.begin(async (tx) => {
    for (const tabla of TABLAS) {
      await tx`delete from ${tx(tabla.nombre)}`;
    }
    await tx`insert into audit_logs (action, module, description, user_name)
             values ('ELIMINAR', 'PRODUCTOS',
                     ${`Se vació el módulo de EPP (${resumen.map((r) => `${r.filas} ${r.etiqueta}`).join(", ")}). Respaldo en ${carpeta}.`},
                     'Sistema')`;
  });

  console.log("\n✔ El almacén quedó vacío. Los trabajadores y sus documentos siguen ahí.");
  console.log("  Siguiente paso: registrar las categorías y luego los EPP con su stock inicial.");
  await sql.end();
  process.exit(0);
}

main().catch((e) => {
  console.error("\nFALLÓ:", e instanceof Error ? e.message : e);
  console.error("No se borró nada.");
  process.exit(1);
});
