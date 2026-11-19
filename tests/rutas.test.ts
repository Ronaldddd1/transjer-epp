/**
 * Rutas de reparto: leer la programación del cliente, ordenar las direcciones, qué se
 * busca en el mapa y el optimizador de rutas.
 *
 *   npx tsx --conditions=react-server tests/rutas.test.ts
 */
import { readFileSync } from "node:fs";
import { candidatos, enDistrito, haversine, titulo } from "../src/lib/rutas/geo";
import { optimizar } from "../src/lib/rutas/optimizar";
import { claveDireccion, limpiarDireccion } from "../src/lib/rutas/programacion";
import { leerExcelProgramacion } from "../src/server/rutas-excel";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("OK  ", n);
  else { fails++; console.log("FALLA", n, JSON.stringify(x ?? "")); }
};

(async () => {
  // ---------- Direcciones escritas a la carrera ----------
  const casos: [string, string, string | null][] = [
    ["CALLENARANJAL115URB CAMACHO", "CALLE NARANJAL 115 URB CAMACHO", null],
    ["AVENIDA TOMÁS MARSANO 397AVENIDA TOMÁS MARSANO 397", "AVENIDA TOMAS MARSANO 397", null],
    ["CALLEBATALLÓN LIBRES DE TRUJILLO 218218URBANIZACIÓN SANTA TERESA", "CALLE BATALLON LIBRES DE TRUJILLO 218 URBANIZACION SANTA TERESA", null],
    ["PASAJE SAN VALENTINPOR EL CANAL 4 EN PACHACAMAC", "PASAJE SAN VALENTIN", "POR EL CANAL 4 EN PACHACAMAC"],
    ["JR. LUNA PIZARRO N° 701", "JR. LUNA PIZARRO 701", null],
    ["AV. PEDRO MIOTTA 130 REF. AL COSTADO DEL COLEGIO", "AV. PEDRO MIOTTA 130", "REF. AL COSTADO DEL COLEGIO"],
  ];
  for (const [entrada, esperada, ref] of casos) {
    const r = limpiarDireccion(entrada);
    check(`«${entrada}» → «${esperada}»`, r.direccion === esperada && r.referencia === ref, r);
  }
  check("AVENIDA no se parte en «AV ENIDA»", !limpiarDireccion("AVENIDA JAVIER PRADO ESTE 5271").direccion.includes("AV ENIDA"));
  check("la misma dirección escrita distinto es la misma parada",
    claveDireccion(limpiarDireccion("AVENIDA TOMÁS MARSANO 397").direccion, "Surquillo")
      === claveDireccion(limpiarDireccion("AVENIDA TOMAS MARSANO 397AVENIDA TOMAS MARSANO 397").direccion, "SURQUILLO"));

  // ---------- La programación real del 20/11 ----------
  const prog = await leerExcelProgramacion(readFileSync("tests/fixtures/programacion-recojo.xlsx"));
  check("encuentra la hoja con las direcciones (no el RESUMEN)", prog.hoja === "LISTA DE PEDIDOS FINAL", prog.hoja);
  check("16 paradas: una por pedido (las 49 filas son productos)", prog.paradas.length === 16, prog.paradas.length);
  const kg = prog.paradas.reduce((s, p) => s + p.kg, 0);
  check("el peso total cuadra con el RESUMEN del cliente (557.32 kg)", Math.abs(kg - 557.32) < 0.05, kg);
  const vivargo = prog.paradas.find((p) => p.pedidos.includes("7503004896"));
  check("cada parada suma el peso de sus productos (Vivargo 120.9 kg)", vivargo?.kg === 120.9, vivargo?.kg);
  check("y lleva la fecha máxima de entrega", vivargo?.fechaMax === "2026-11-20", vivargo?.fechaMax);
  check("y los productos con su cantidad", (vivargo?.productos.length ?? 0) === 3 && vivargo!.productos[1].cantidad === 2);
  const sauvi = prog.paradas.find((p) => p.pedidos.includes("7503001757"));
  check("la referencia se separa de la dirección", sauvi?.referencia === "POR PORTON DE JICAMARCA", sauvi);
  check("el teléfono viene", sauvi?.telefono === "904405955");

  // ---------- Qué se busca en el mapa ----------
  const c1 = candidatos("CALLE NARANJAL 115 URB CAMACHO", "LA MOLINA");
  check("primero la vía con número, luego la vía, la urbanización y el distrito",
    c1.map((c) => c.calidad).join(",") === "EXACTA,CALLE,ZONA,DISTRITO" && c1[0].consulta === "Calle Naranjal 115, La Molina, Lima, Peru", c1);
  const c2 = candidatos("MAZ VV 2 A LOT 1 11 ASOCIA VILLA SOL NACIENTE 11", "SAN JUAN DE LURIGANCHO");
  check("manzana y lote: se busca la asociación", c2[0].calidad === "ZONA" && c2[0].consulta.startsWith("Villa Sol Naciente,"), c2);
  check("las abreviaturas se escriben completas", candidatos("JR. LUNA PIZARRO 701", "LA VICTORIA")[0].consulta.startsWith("Jiron Luna Pizarro 701"));
  check("el distrito con mayúsculas de nombre", titulo("SAN JUAN DE LURIGANCHO") === "San Juan de Lurigancho");
  check("un resultado de otro distrito se rechaza",
    !enDistrito({ lat: -12.08, lng: -77.03, partes: ["Avenida Los Álamos", "San Isidro", "Lima"] }, "LA MOLINA"));
  check("uno que nombra el distrito se acepta",
    enDistrito({ lat: -12.08, lng: -76.94, partes: ["Calle Naranjal", "La Molina", "Lima"] }, "LA MOLINA"));
  check("fuera de Lima, nunca", !enDistrito({ lat: -8.1, lng: -79.0, partes: ["La Molina"] }, "LA MOLINA"));
  check("distancia en línea recta (Lurín–Miraflores ≈ 25 km)",
    Math.abs(haversine({ lat: -12.2746, lng: -76.8706 }, { lat: -12.1211, lng: -77.0297 }) / 1000 - 24.3) < 1.5);

  // ---------- El optimizador ----------
  // Puntos en una línea: el centro en 0, la cochera en 10; paradas en 2, 4, 6, 8.
  const linea = (xs: number[]) => xs.map((a) => xs.map((b) => Math.abs(a - b) * 1000));
  const x1 = [0, 6, 2, 8, 4, 10];
  const r1 = optimizar({ distancias: linea(x1), kg: [0, 1, 1, 1, 1], m3: [0, 0, 0, 0, 0], moviles: [{ capacidadKg: null, capacidadM3: null, maxParadas: null }] });
  check("una móvil recorre la línea en orden (2,4,6,8): 10 km", r1.rutas[0].map((i) => x1[i]).join(",") === "2,4,6,8" && r1.total === 10000, r1);

  // Brute force: comparar con la mejor ruta posible en casos chicos.
  const permutaciones = (a: number[]): number[][] => a.length <= 1 ? [a] : a.flatMap((x, i) => permutaciones([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]));
  let semilla = 11;
  const azar = () => ((semilla = (semilla * 16807) % 2147483647) / 2147483647);
  let iguales = 0;
  for (let caso = 0; caso < 25; caso++) {
    const n = 6;
    const pts = Array.from({ length: n + 2 }, () => ({ x: azar() * 30, y: azar() * 30 }));
    const dist = pts.map((a) => pts.map((b) => Math.hypot(a.x - b.x, a.y - b.y) * 1000));
    const res = optimizar({ distancias: dist, kg: Array(n + 1).fill(1), m3: Array(n + 1).fill(0), moviles: [{ capacidadKg: null, capacidadM3: null, maxParadas: null }], semilla: caso + 1 });
    const costo = (r: number[]) => dist[0][r[0]] + r.slice(1).reduce((s, x, i) => s + dist[r[i]][x], 0) + dist[r[r.length - 1]][n + 1];
    const mejor = Math.min(...permutaciones(Array.from({ length: n }, (_, i) => i + 1)).map(costo));
    if (res.total <= mejor + 1e-6) iguales++;
  }
  check("con una móvil encuentra la ruta más corta posible (25 casos al azar, comparado con todas las combinaciones)", iguales === 25, iguales);

  // Dos móviles con capacidad: no se pasa de lo que admite cada una.
  const pts = Array.from({ length: 12 }, (_, i) => ({ x: Math.cos(i) * 10 + 10, y: Math.sin(i * 1.7) * 10 + 10 }));
  const dist = pts.map((a) => pts.map((b) => Math.hypot(a.x - b.x, a.y - b.y) * 1000));
  const kgs = [0, 40, 60, 80, 30, 50, 70, 20, 90, 10, 45];
  const dos = optimizar({ distancias: dist, kg: kgs, m3: Array(11).fill(0), moviles: [{ capacidadKg: 250, capacidadM3: null, maxParadas: null }, { capacidadKg: 300, capacidadM3: null, maxParadas: null }], intentos: 200 });
  const cargas = dos.rutas.map((r) => r.reduce((s, x) => s + kgs[x], 0));
  check("respeta la capacidad en kg de cada móvil", cargas[0] <= 250 && cargas[1] <= 300, cargas);
  check("y reparte todas las paradas", dos.sinAsignar.length === 0 && dos.rutas.flat().length === 10, dos);
  const tope = optimizar({ distancias: dist, kg: kgs, m3: Array(11).fill(0), moviles: [{ capacidadKg: null, capacidadM3: null, maxParadas: 4 }, { capacidadKg: null, capacidadM3: null, maxParadas: 6 }], intentos: 200 });
  check("respeta el máximo de paradas acordado por móvil", tope.rutas[0].length <= 4 && tope.rutas[1].length <= 6 && tope.sinAsignar.length === 0, tope.rutas.map((r) => r.length));
  const falta = optimizar({ distancias: dist, kg: kgs, m3: Array(11).fill(0), moviles: [{ capacidadKg: 200, capacidadM3: null, maxParadas: null }], intentos: 200 });
  check("si no alcanza la capacidad, dice qué paradas quedan fuera", falta.sinAsignar.length > 0 && falta.rutas[0].reduce((s, x) => s + kgs[x], 0) <= 200, falta);
  const m3 = optimizar({ distancias: dist, kg: Array(11).fill(0), m3: [0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], moviles: [{ capacidadKg: null, capacidadM3: 2, maxParadas: null }, { capacidadKg: null, capacidadM3: 3, maxParadas: null }], intentos: 200 });
  check("también respeta el volumen (m³)", m3.rutas[0].length <= 4 && m3.rutas[1].length <= 6 && m3.sinAsignar.length === 0, m3.rutas.map((r) => r.length));
  const otra = optimizar({ distancias: dist, kg: kgs, m3: Array(11).fill(0), moviles: [{ capacidadKg: 250, capacidadM3: null, maxParadas: null }, { capacidadKg: 300, capacidadM3: null, maxParadas: null }], intentos: 200 });
  check("el mismo archivo da siempre la misma ruta", JSON.stringify(otra.rutas) === JSON.stringify(dos.rutas));

  // Jornada máxima: con una sola móvil y poca jornada, no entra todo.
  const seg = dist.map((f) => f.map((x) => x / (25000 / 3600)));
  const libre = optimizar({ distancias: dist, kg: kgs, m3: Array(11).fill(0), moviles: [{ capacidadKg: null, capacidadM3: null, maxParadas: null }], intentos: 100 });
  const tiempoDe = (r: number[]) => seg[0][r[0]] + r.slice(1).reduce((s, x, i) => s + seg[r[i]][x], 0) + seg[r[r.length - 1]][11] + 900 * r.length;
  const tLibre = tiempoDe(libre.rutas[0]);
  const corta = optimizar({ distancias: dist, duraciones: seg, servicioSeg: 900, kg: kgs, m3: Array(11).fill(0),
    moviles: [{ capacidadKg: null, capacidadM3: null, maxParadas: null, maxSegundos: tLibre * 0.6 }], intentos: 100 });
  check("respeta la jornada máxima (si no alcanza, deja paradas fuera)",
    corta.sinAsignar.length > 0 && tiempoDe(corta.rutas[0]) <= tLibre * 0.6 + 1, { t: tiempoDe(corta.rutas[0]), max: tLibre * 0.6 });
  const dosJ = optimizar({ distancias: dist, duraciones: seg, servicioSeg: 900, kg: kgs, m3: Array(11).fill(0),
    moviles: [0, 1].map(() => ({ capacidadKg: null, capacidadM3: null, maxParadas: null, maxSegundos: tLibre * 0.7 })), intentos: 100 });
  check("con dos móviles y esa jornada, se reparte y entra todo", dosJ.sinAsignar.length === 0 && dosJ.rutas.every((r) => r.length > 0 && tiempoDe(r) <= tLibre * 0.7 + 1), dosJ.rutas);

  // El tramo cochera → centro: lo hace cada móvil que sale.
  const unaSola = optimizar({ distancias: dist, kg: kgs, m3: Array(11).fill(0), salidaMetros: 20000, intentos: 150,
    moviles: [0, 1].map(() => ({ capacidadKg: 5000, capacidadM3: null, maxParadas: null })) });
  check("si una móvil puede con todo, sale una sola (otra sumaría su tramo cochera → centro)",
    unaSola.rutas.filter((r) => r.length).length === 1, unaSola.rutas.map((r) => r.length));
  const conTramo = optimizar({ distancias: dist, kg: kgs, m3: Array(11).fill(0), salidaMetros: 20000, intentos: 50,
    moviles: [{ capacidadKg: null, capacidadM3: null, maxParadas: null }] });
  const sinTramo = optimizar({ distancias: dist, kg: kgs, m3: Array(11).fill(0), intentos: 50,
    moviles: [{ capacidadKg: null, capacidadM3: null, maxParadas: null }] });
  check("los km incluyen el tramo cochera → centro", Math.abs(conTramo.total - sinTramo.total - 20000) < 1e-6, [conTramo.total, sinTramo.total]);
  const cortaJ = optimizar({ distancias: dist, duraciones: seg, servicioSeg: 900, salidaSegundos: 3600, kg: kgs, m3: Array(11).fill(0), intentos: 50,
    moviles: [{ capacidadKg: null, capacidadM3: null, maxParadas: null, maxSegundos: tiempoDe(libre.rutas[0]) + 1800 }] });
  check("y la jornada cuenta el tramo de salida (con una hora más de salida, ya no entra todo)", cortaJ.sinAsignar.length > 0, cortaJ.sinAsignar);

  // Rutas coherentes: dos zonas separadas, dos móviles que no pueden con todo: cada una
  // se queda con su zona, sin mezclar.
  const zonaA = Array.from({ length: 6 }, (_, i) => ({ x: -20 + (i % 3) * 1.5, y: 10 + Math.floor(i / 3) * 1.5 }));
  const zonaB = Array.from({ length: 6 }, (_, i) => ({ x: 20 + (i % 3) * 1.5, y: 10 + Math.floor(i / 3) * 1.5 }));
  const mezcla = [zonaA[0], zonaB[0], zonaA[1], zonaB[1], zonaA[2], zonaB[2], zonaA[3], zonaB[3], zonaA[4], zonaB[4], zonaA[5], zonaB[5]];
  const ptsZ = [{ x: 0, y: 0 }, ...mezcla, { x: 0, y: -2 }];
  const dZ = ptsZ.map((a) => ptsZ.map((b) => Math.hypot(a.x - b.x, a.y - b.y) * 1000));
  const zonas = optimizar({ distancias: dZ, kg: [0, ...Array(12).fill(10)], m3: Array(13).fill(0), salidaMetros: 5000, intentos: 200,
    moviles: [0, 1].map(() => ({ capacidadKg: 60, capacidadM3: null, maxParadas: null })) });
  const lado = (i: number) => (ptsZ[i].x < 0 ? "A" : "B");
  check("dos grupos de entregas separados: cada móvil hace uno entero, sin cruzar al otro lado y volver",
    zonas.sinAsignar.length === 0 && zonas.rutas.every((r) => r.length === 6 && new Set(r.map(lado)).size === 1),
    zonas.rutas.map((r) => r.map(lado).join("")));

  // Rutas coherentes: ninguna ruta se cruza consigo misma (sin idas y vueltas).
  const cruzan = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }, t: { x: number; y: number }) => {
    const o = (a: typeof p, b: typeof p, c: typeof p) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    return o(p, q, r) * o(p, q, t) < 0 && o(r, t, p) * o(r, t, q) < 0;
  };
  let sinCruces = 0;
  for (let caso = 0; caso < 30; caso++) {
    let sem = 100 + caso;
    const rnd = () => ((sem = (sem * 16807) % 2147483647) / 2147483647);
    const n = 14;
    const pts = Array.from({ length: n + 2 }, () => ({ x: rnd() * 40, y: rnd() * 40 }));
    const dd = pts.map((a) => pts.map((b) => Math.hypot(a.x - b.x, a.y - b.y) * 1000));
    const res = optimizar({ distancias: dd, kg: [0, ...Array(n).fill(10)], m3: Array(n + 1).fill(0), salidaMetros: 8000,
      moviles: [0, 1].map(() => ({ capacidadKg: 80, capacidadM3: null, maxParadas: null })), semilla: caso + 1 });
    const ok = res.rutas.every((r) => {
      const camino = [pts[0], ...r.map((i) => pts[i]), pts[n + 1]];
      for (let i = 0; i < camino.length - 1; i++) {
        for (let k = i + 2; k < camino.length - 1; k++) {
          if (cruzan(camino[i], camino[i + 1], camino[k], camino[k + 1])) return false;
        }
      }
      return true;
    });
    if (ok) sinCruces++;
  }
  check("ninguna ruta se cruza consigo misma (30 casos al azar, 14 entregas y 2 móviles)", sinCruces === 30, sinCruces);

  console.log(fails ? `\n${fails} comprobación(es) fallaron.` : "\nTodo en orden.");
  process.exit(fails ? 1 : 0);
})();
