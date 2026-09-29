/**
 * Prueba del módulo de obligaciones con los cronogramas reales de Transjer.
 * Carga los cuatro formatos de banco por el mismo camino que la pantalla y comprueba
 * que la base rechaza los estados imposibles.
 *
 *   npx tsx --conditions=react-server tests/obligaciones.test.ts
 */
import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import { obligationInstallments, obligations, users } from "../src/db/schema";
import { applyMapping, detectSchedule } from "../src/lib/amortization";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("OK  ", n);
  else { fails++; console.log("FALLA", n, JSON.stringify(x ?? "")); }
};

const CRONOGRAMAS = {
  "BCP Crédito Negocios": `
160225 250,000.00 8,699.63 3,339.62 232.50 0.00 0.00 12,271.75
160325 241,300.38 9,266.24 2,802.82 202.69 0.00 0.00 12,271.75
160425 232,034.14 9,072.00 2,983.95 215.79 0.00 0.00 12,271.75
160525 222,962.14 9,296.29 2,774.79 200.67 0.00 0.00 12,271.75
160625 213,665.86 9,325.30 2,747.74 198.71 0.00 0.00 12,271.75
160725 204,340.56 9,544.80 2,543.05 183.91 0.00 0.00 12,271.75`,
  "Interbank Capital de Trabajo": `
1 08/06/2026 45 250,012.50 7,369.98 4,955.08 0.00 0.00 0.00 12,325.06
2 08/07/2026 30 242,642.52 9,129.55 3,195.51 0.00 0.00 0.00 12,325.06
3 08/08/2026 31 233,512.97 9,146.58 3,178.48 0.00 0.00 0.00 12,325.06
4 08/09/2026 31 224,366.39 9,271.08 3,053.98 0.00 0.00 0.00 12,325.06`,
  "Crédito Pyme": `
1 6/12/25 6443.02 2370.53 0.00 0.00 8813.55
2 6/01/26 6451.17 2362.38 0.00 0.00 8813.55
3 6/02/26 6538.98 2274.57 0.00 0.00 8813.55`,
};

async function main() {
  const [admin] = await db.select().from(users).limit(1);

  // Limpieza de corridas anteriores.
  await db.delete(obligations).where(sql`${obligations.name} like 'PRUEBA %'`);

  for (const [nombre, texto] of Object.entries(CRONOGRAMAS)) {
    const d = detectSchedule(texto);
    if ("error" in d) { fails++; console.log("FALLA detectar", nombre, d.error); continue; }
    const { rows, errors } = applyMapping(d, d.guess);
    check(`${nombre}: se lee sin avisos`, errors.length === 0, errors);

    const [o] = await db.insert(obligations).values({
      type: "PRESTAMO", name: `PRUEBA ${nombre}`, creditor: nombre.split(" ")[0],
      currency: "PEN", principal: "250000.00", annualRate: "17.000",
      disbursedAt: "2025-01-16", createdBy: admin?.id ?? null,
    }).returning();

    let saldo = 250000;
    await db.insert(obligationInstallments).values(rows.map((r) => {
      saldo = Math.round((saldo - (r.principal ?? 0)) * 100) / 100;
      return {
        obligationId: o.id, number: r.number, dueDate: r.dueDate,
        principal: r.principal?.toFixed(2) ?? null,
        interest: r.interest?.toFixed(2) ?? null,
        insurance: r.insurance?.toFixed(2) ?? null,
        total: r.total.toFixed(2), balanceAfter: saldo.toFixed(2),
      };
    }));

    const guardadas = await db.select().from(obligationInstallments).where(eq(obligationInstallments.obligationId, o.id));
    check(`${nombre}: se guardan ${rows.length} cuotas`, guardadas.length === rows.length, guardadas.length);
    check(`${nombre}: la cuota guardada coincide con el papel`,
      Number(guardadas[0].total) === rows[0].total, { guardado: guardadas[0].total, papel: rows[0].total });
  }

  // --- Reglas de la base ---
  const [o] = await db.select().from(obligations).where(sql`${obligations.name} like 'PRUEBA %'`).limit(1);

  // Una cuota pagada debe llevar fecha de pago: lo exige la propia base.
  let ok = false;
  try {
    await db.insert(obligationInstallments).values({
      obligationId: o.id, number: 900, dueDate: "2027-01-01", total: "100.00", status: "PAGADA", paidAt: null,
    });
  } catch { ok = true; }
  check("la base rechaza una cuota pagada sin fecha de pago", ok);

  // Dos cuotas con el mismo número en la misma obligación: imposible.
  ok = false;
  try {
    await db.insert(obligationInstallments).values([
      { obligationId: o.id, number: 901, dueDate: "2027-01-01", total: "100.00" },
      { obligationId: o.id, number: 901, dueDate: "2027-02-01", total: "100.00" },
    ]);
  } catch { ok = true; }
  check("la base rechaza dos cuotas con el mismo número", ok);

  // Importe cero o negativo.
  ok = false;
  try {
    await db.insert(obligationInstallments).values({ obligationId: o.id, number: 902, dueDate: "2027-01-01", total: "0.00" });
  } catch { ok = true; }
  check("la base rechaza una cuota de importe cero", ok);

  // Un servicio variable sí puede tener cuota sin importe.
  const [servicio] = await db.insert(obligations).values({
    type: "SERVICIO", name: "PRUEBA Claro flota", creditor: "Claro", currency: "PEN",
    billingDay: 15, variableAmount: true, createdBy: admin?.id ?? null,
  }).returning();
  await db.insert(obligationInstallments).values({ obligationId: servicio.id, number: 1, dueDate: "2026-10-15", total: null });
  const [cuota] = await db.select().from(obligationInstallments).where(eq(obligationInstallments.obligationId, servicio.id));
  check("un servicio variable admite cuota sin importe", cuota.total === null);

  // Al borrar la obligación se van sus cuotas.
  await db.delete(obligations).where(eq(obligations.id, servicio.id));
  const huerfanas = await db.select().from(obligationInstallments).where(eq(obligationInstallments.obligationId, servicio.id));
  check("al borrar la obligación se borran sus cuotas", huerfanas.length === 0);

  await db.delete(obligations).where(sql`${obligations.name} like 'PRUEBA %'`);
  console.log(fails === 0 ? "\nOBLIGACIONES: todas las verificaciones superadas" : `\n${fails} FALLAS`);
  process.exit(fails === 0 ? 0 : 1);
}

main();
