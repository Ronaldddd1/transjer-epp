/**
 * La regla de las guías de transporte y la lectura de varias estibas.
 *
 *   npx tsx tests/guias-estibas.test.ts
 */
import { separarGuias, vencimientoPorGuias } from "../src/lib/guias";
import { estibaPrincipal, leerEstibas } from "../src/lib/validations";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("OK  ", n);
  else { fails++; console.log("FALLA", n, JSON.stringify(x ?? "")); }
};
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// --- Separar los números de guía ---
check("con barra", igual(separarGuias("T001-120 / T001-121"), ["T001-120", "T001-121"]), separarGuias("T001-120 / T001-121"));
check("con coma y con y", igual(separarGuias("eg03-12, EG03-13 y EG03-14"), ["EG03-12", "EG03-13", "EG03-14"]));
check("sin repetir", igual(separarGuias("T001-5/t001-5"), ["T001-5"]));
check("vacío, ninguna", igual(separarGuias(""), []) && igual(separarGuias(null), []));
check("un número con guion queda entero", igual(separarGuias("T001 - 000123"), ["T001 - 000123"]));

// --- El plazo ---
const r = "2026-11-02";
check("sin guías no hay fecha", vencimientoPorGuias([], r).payDueDate === null);
check("falta una: no hay fecha", vencimientoPorGuias([{ receivedAt: "2026-11-05" }, { receivedAt: null }], r).payDueDate === null);
const todas = vencimientoPorGuias([{ receivedAt: "2026-11-05" }, { receivedAt: "2026-11-09" }], r);
check("llegaron todas: 15 días desde la última", todas.payDueDate === "2026-11-24" && todas.guideReceivedAt === "2026-11-09", todas);
check("y cuenta cuántas llegaron", todas.llegaron === 2 && todas.completas);
check("una guía que llegó antes que la factura cuenta desde la factura",
  vencimientoPorGuias([{ receivedAt: "2026-10-30" }], r).payDueDate === "2026-11-17");

// --- Estibas ---
const fd = (filas: string[][]) => {
  const f = new FormData();
  for (const [n, t, c, o] of filas) { f.append("estiba_nombre", n); f.append("estiba_telefono", t); f.append("estiba_costo", c); f.append("estiba_nota", o); }
  return f;
};
const dos = leerEstibas(fd([["Norte", "976111222", "45", ""], ["Sur", "", "35.5", "trae 4"]]));
check("lee las dos estibas", dos.estibas.length === 2 && !Object.keys(dos.errores).length, dos);
check("con el costo en dos decimales", dos.estibas[1].costPerTon === "35.50");
check("una fila vacía se ignora", leerEstibas(fd([["", "", "", ""], ["Norte", "", "40", ""]])).estibas.length === 1);
const mal = leerEstibas(fd([["Norte", "", "abc", ""]]));
check("un costo mal escrito marca su casilla", !!mal.errores.estiba_costo_0, mal.errores);
check("solo una nota no es una estiba", !!leerEstibas(fd([["", "", "", "algo"]])).errores.estiba_nombre_0);
check("la principal es la más barata", estibaPrincipal(dos.estibas)?.name === "Sur");
check("sin precios, la primera", estibaPrincipal([{ name: "A", costPerTon: null }, { name: "B", costPerTon: null }])?.name === "A");
check("sin estibas, ninguna", estibaPrincipal([]) === null);

console.log(fails ? `\n${fails} FALLAS` : "\nTodo en orden.");
process.exit(fails ? 1 : 0);
