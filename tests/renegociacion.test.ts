/**
 * Renegociar el importe de un servicio.
 *
 * Lo que importa de esto es lo que NO cambia. Una cochera que costaba 300 pasa a 350, y
 * los meses que ya se pagaron a 300 tienen que seguir diciendo 300: si el precio nuevo se
 * aplicara hacia atrás, los totales del año dejarían de cuadrar con lo que de verdad salió
 * de caja, y no habría forma de darse cuenta mirando la pantalla.
 *
 *   npx tsx --conditions=react-server tests/renegociacion.test.ts
 */
import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import { obligationInstallments, obligations } from "../src/db/schema";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("OK  ", n);
  else { fails++; console.log("FALLA", n, JSON.stringify(x ?? "")); }
};

const SELLO = `RENEG ${Date.now()}`;

/**
 * La regla, tal cual la aplica la acción: solo las cuotas PENDIENTES que vencen desde el
 * mes indicado. Se prueba contra la base de verdad, no contra una imitación en memoria.
 */
async function renegociar(id: string, importe: string, desdeMes: string) {
  const desde = `${desdeMes}-01`;
  const cambiadas = await db.update(obligationInstallments)
    .set({ total: importe })
    .where(sql`${obligationInstallments.obligationId} = ${id}
      and ${obligationInstallments.status} = 'PENDIENTE'
      and ${obligationInstallments.dueDate} >= ${desde}`)
    .returning({ id: obligationInstallments.id });
  await db.update(obligations).set({ fixedAmount: importe }).where(eq(obligations.id, id));
  return cambiadas.length;
}

async function main() {
  await db.delete(obligations).where(sql`${obligations.name} like 'RENEG %'`);

  const [cochera] = await db.insert(obligations).values({
    type: "COCHERA", name: `${SELLO} cochera`, creditor: "Playa Central", currency: "PEN",
    billingDay: 5, variableAmount: false, fixedAmount: "300.00",
  }).returning();

  // Seis meses a 300: los tres primeros pagados, los tres siguientes por pagar.
  await db.insert(obligationInstallments).values([
    { obligationId: cochera.id, number: 1, dueDate: "2026-08-05", total: "300.00", status: "PAGADA", paidAt: "2026-08-05", paidAmount: "300.00" },
    { obligationId: cochera.id, number: 2, dueDate: "2026-09-05", total: "300.00", status: "PAGADA", paidAt: "2026-09-05", paidAmount: "300.00" },
    { obligationId: cochera.id, number: 3, dueDate: "2026-10-05", total: "300.00", status: "PAGADA", paidAt: "2026-10-05", paidAmount: "300.00" },
    { obligationId: cochera.id, number: 4, dueDate: "2026-11-05", total: "300.00" },
    { obligationId: cochera.id, number: 5, dueDate: "2026-12-05", total: "300.00" },
    { obligationId: cochera.id, number: 6, dueDate: "2027-01-05", total: "300.00" },
  ]);

  // Se acuerda 350 desde diciembre.
  const cambiadas = await renegociar(cochera.id, "350.00", "2026-12");
  check("solo cambia de diciembre en adelante", cambiadas === 2, cambiadas);

  const cuotas = await db.select({
    numero: obligationInstallments.number,
    vence: obligationInstallments.dueDate,
    total: obligationInstallments.total,
    estado: obligationInstallments.status,
  }).from(obligationInstallments)
    .where(eq(obligationInstallments.obligationId, cochera.id))
    .orderBy(obligationInstallments.number);

  const por = (n: number) => cuotas.find((c) => c.numero === n);

  check("agosto, pagado, sigue a 300", por(1)?.total === "300.00", por(1));
  check("setiembre, pagado, sigue a 300", por(2)?.total === "300.00", por(2));
  check("octubre, pagado, sigue a 300", por(3)?.total === "300.00", por(3));
  // Noviembre está pendiente pero es anterior al acuerdo: se debe al precio de antes.
  check("noviembre, pendiente pero anterior, sigue a 300", por(4)?.total === "300.00", por(4));
  check("diciembre pasa a 350", por(5)?.total === "350.00", por(5));
  check("enero pasa a 350", por(6)?.total === "350.00", por(6));

  check("ninguna cuota pagada cambió de estado",
    cuotas.filter((c) => c.estado === "PAGADA").length === 3, cuotas.map((c) => c.estado));

  // Lo que se pagó de verdad queda intacto: es el dato que no se puede perder.
  const [{ pagado }] = await db.select({ pagado: sql<string>`coalesce(sum(${obligationInstallments.paidAmount}), 0)::text` })
    .from(obligationInstallments).where(eq(obligationInstallments.obligationId, cochera.id));
  check("lo efectivamente pagado sigue sumando 900", Number(pagado) === 900, pagado);

  // El importe de la obligación queda en el nuevo, para los meses que se generen después.
  const [despues] = await db.select({ fixedAmount: obligations.fixedAmount })
    .from(obligations).where(eq(obligations.id, cochera.id));
  check("el servicio queda con el precio nuevo", despues.fixedAmount === "350.00", despues);

  // ---------- Una segunda renegociación, hacia abajo ----------
  const otraVez = await renegociar(cochera.id, "280.00", "2027-01");
  check("la segunda renegociación toca solo enero", otraVez === 1, otraVez);
  const ahora = await db.select({ numero: obligationInstallments.number, total: obligationInstallments.total })
    .from(obligationInstallments).where(eq(obligationInstallments.obligationId, cochera.id))
    .orderBy(obligationInstallments.number);
  check("diciembre conserva los 350 del acuerdo anterior",
    ahora.find((c) => c.numero === 5)?.total === "350.00", ahora);
  check("enero queda en 280", ahora.find((c) => c.numero === 6)?.total === "280.00", ahora);
  // Tres precios distintos conviviendo: eso es tener el histórico.
  check("el cronograma guarda los tres precios",
    new Set(ahora.map((c) => c.total)).size === 3, ahora.map((c) => c.total));

  await db.delete(obligations).where(sql`${obligations.name} like 'RENEG %'`);
  console.log(fails === 0 ? "\nTodo en orden." : `\n${fails} comprobación(es) fallaron.`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); process.exit(1); });
