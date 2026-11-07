/**
 * El destino de una factura nueva toma la escritura que ya existe.
 *
 *   npx tsx --conditions=react-server tests/destinos.test.ts
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { destinoCanonico } from "../src/server/invoice-service";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("OK  ", n);
  else { fails++; console.log("FALLA", n, JSON.stringify(x ?? "")); }
};

const S = String(Date.now()).slice(-6);
const PROV = `Destinos prueba ${S}`;

async function limpiar() {
  await db.execute(sql`delete from supplier_invoices where supplier_id in (select id from suppliers where business_name like 'Destinos prueba %')`);
  await db.execute(sql`delete from suppliers where business_name like 'Destinos prueba %'`);
}

async function main() {
  await limpiar();
  await db.execute(sql`insert into suppliers (business_name) values (${PROV})`);
  const facturas: [string, string][] = [
    ["1", `Huaral${S}`], ["2", `Huaral${S}`], ["3", `HUARAL${S}`], ["4", `Jaén${S}`],
  ];
  for (const [n, d] of facturas) {
    await db.execute(sql`insert into supplier_invoices (supplier_id, series, number, issue_date, total, destination_city)
      select id, 'F001', ${n + S}, current_date, 100, ${d} from suppliers where business_name = ${PROV}`);
  }

  check("en minúsculas y con espacios toma la escritura más usada",
    (await destinoCanonico(db, `  huaral${S}   `)) === `Huaral${S}`, await destinoCanonico(db, `  huaral${S}   `));
  check("sin tilde toma la que tiene tilde", (await destinoCanonico(db, `JAEN${S}`)) === `Jaén${S}`, await destinoCanonico(db, `JAEN${S}`));
  check("un destino nuevo se guarda limpio, sin espacios de más",
    (await destinoCanonico(db, `  San   Vicente ${S} `)) === `San Vicente ${S}`);
  check("vacío queda vacío", (await destinoCanonico(db, "   ")) === null && (await destinoCanonico(db, null)) === null);
  check("una 's' del nombre no se toca (la expresión es de espacios, no de letras)",
    (await destinoCanonico(db, `Chancas${S}`)) === `Chancas${S}`);

  await limpiar();
  console.log(fails === 0 ? "\nTodo en orden." : `\n${fails} comprobación(es) fallaron.`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch(async (e) => { console.error(e); await limpiar().catch(() => {}); process.exit(1); });
