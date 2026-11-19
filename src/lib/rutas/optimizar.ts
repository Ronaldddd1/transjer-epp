/**
 * El reparto de las paradas entre las móviles y el orden de cada ruta.
 *
 * Es el problema de ruteo de vehículos con capacidad: cada móvil sale del centro de
 * recojo (Lurín), hace sus entregas y termina en la cochera; no puede llevar más peso ni
 * más volumen de lo que admite, ni (si se pidió) más paradas que el máximo acordado. Se
 * busca que la suma de kilómetros de todas las móviles sea la menor.
 *
 * No hay una fórmula que dé la mejor ruta exacta en un tiempo razonable, así que se hace
 * como lo hacen los programas de ruteo:
 *
 *  1. Construcción por "arrepentimiento" (regret): en cada paso se ubica primero la parada
 *     que más se perdería si no se la pone ya en su mejor sitio.
 *  2. Mejora local: mover una parada a otro lugar u otra móvil, intercambiar dos paradas
 *     entre móviles e invertir tramos de una ruta (2-opt), mientras se gane distancia.
 *  3. Destruir y reconstruir: se sacan unas cuantas paradas al azar (o las más cercanas
 *     entre sí) y se vuelven a meter; si el resultado es mejor, se queda. Se repite
 *     hasta agotar el tiempo.
 *
 * Todo trabaja sobre la matriz de distancias por las calles, así que respeta los
 * sentidos de las vías (ir de A a B no cuesta lo mismo que de B a A).
 *
 * Índices: 0 es el centro de recojo, 1..n las paradas y n+1 la cochera.
 */

export type Movil = {
  capacidadKg: number | null;
  capacidadM3: number | null;
  maxParadas: number | null;
  /** Jornada máxima: manejo más el tiempo en cada entrega, en segundos. */
  maxSegundos?: number | null;
};

export type Entrada = {
  /** Metros entre cada par de puntos, (n+2)×(n+2). */
  distancias: number[][];
  /** Peso y volumen de cada parada (1..n; la posición 0 se ignora). */
  kg: number[];
  m3: number[];
  moviles: Movil[];
  /** Segundos de manejo entre cada par de puntos; hace falta para la jornada máxima. */
  duraciones?: number[][];
  /** Segundos que se queda la móvil en cada entrega. */
  servicioSeg?: number;
  /**
   * Repartir las paradas parejo entre todas las móviles: si se marcaron tres, salen las
   * tres. Sin esto, se usan las que hagan menos kilómetros (a veces una sola).
   */
  repartir?: boolean;
  /** Milisegundos como máximo para buscar mejoras (un tope de seguridad). */
  tiempoMs?: number;
  /**
   * Cuántas veces se destruye y reconstruye. Es lo que manda (no el reloj), para que el
   * mismo archivo dé siempre la misma ruta, en cualquier computadora.
   */
  intentos?: number;
  /** Semilla para que el mismo archivo dé siempre la misma ruta. */
  semilla?: number;
};

export type Salida = {
  /** Las paradas (1..n) de cada móvil, en orden de visita. */
  rutas: number[][];
  /** Las que no entran en ninguna móvil (falta capacidad). */
  sinAsignar: number[];
  metros: number[];
  total: number;
};

const EPS = 1e-6;

export function optimizar(e: Entrada): Salida {
  const n = e.distancias.length - 2;
  const V = e.moviles.length;
  if (!e.repartir || V < 2 || n < 2) return resolver(e);
  // Parejo: cada móvil lleva como mucho su parte (n / V, redondeado arriba). Si por la
  // capacidad o la jornada alguna no puede con su parte, se da un poco de holgura.
  let ultimo: Salida | null = null;
  for (let holgura = 0; holgura <= n; holgura++) {
    const parte = Math.ceil(n / V) + holgura;
    const r = resolver({
      ...e,
      moviles: e.moviles.map((m) => ({ ...m, maxParadas: m.maxParadas == null ? parte : Math.min(m.maxParadas, parte) })),
    });
    if (!r.sinAsignar.length) return r;
    ultimo = r;
    if (parte >= n) break;
  }
  const libre = resolver(e);
  return libre.sinAsignar.length <= (ultimo?.sinAsignar.length ?? Infinity) ? libre : ultimo!;
}

function resolver(e: Entrada): Salida {
  const n = e.distancias.length - 2;
  const fin = n + 1;
  const d = e.distancias;
  const V = e.moviles.length;
  const azar = generador(e.semilla ?? 7);
  const tope = Date.now() + (e.tiempoMs ?? 8000);

  const costo = (r: number[]) => {
    if (!r.length) return 0;
    let c = d[0][r[0]];
    for (let i = 1; i < r.length; i++) c += d[r[i - 1]][r[i]];
    return c + d[r[r.length - 1]][fin];
  };
  const carga = (r: number[]) => r.reduce((s, x) => [s[0] + (e.kg[x] ?? 0), s[1] + (e.m3[x] ?? 0)], [0, 0]);
  const t = e.duraciones;
  const servicio = e.servicioSeg ?? 0;
  /** La jornada de una ruta: manejo de Lurín a la cochera más el tiempo en cada entrega. */
  const jornada = (r: number[]) => {
    if (!r.length || !t) return 0;
    let s = t[0][r[0]];
    for (let i = 1; i < r.length; i++) s += t[r[i - 1]][r[i]];
    return s + t[r[r.length - 1]][fin] + servicio * r.length;
  };
  const enJornada = (v: number, r: number[]) => {
    const max = e.moviles[v].maxSegundos;
    return max == null || !t || jornada(r) <= max + EPS;
  };
  const cabe = (v: number, r: number[]) => {
    const m = e.moviles[v];
    if (m.maxParadas != null && r.length > m.maxParadas) return false;
    if (!enJornada(v, r)) return false;
    const [kg, m3] = carga(r);
    if (m.capacidadKg != null && kg > m.capacidadKg + EPS) return false;
    if (m.capacidadM3 != null && m3 > m.capacidadM3 + EPS) return false;
    return true;
  };
  /** Lo que cuesta meter x en la ruta r en la posición p (sin copiar la ruta). */
  const costoInsertar = (r: number[], x: number, p: number) => {
    const antes = p === 0 ? 0 : r[p - 1];
    const despues = p === r.length ? fin : r[p];
    if (!r.length) return d[0][x] + d[x][fin];
    return d[antes][x] + d[x][despues] - d[antes][despues];
  };
  const puedeAgregar = (v: number, r: number[], x: number) => {
    const m = e.moviles[v];
    if (m.maxParadas != null && r.length + 1 > m.maxParadas) return false;
    const [kg, m3] = carga(r);
    if (m.capacidadKg != null && kg + (e.kg[x] ?? 0) > m.capacidadKg + EPS) return false;
    if (m.capacidadM3 != null && m3 + (e.m3[x] ?? 0) > m.capacidadM3 + EPS) return false;
    return true;
  };

  /** Mete las paradas pendientes con el criterio de arrepentimiento. */
  function reconstruir(rutas: number[][], pendientes: number[]) {
    const quedan = new Set(pendientes);
    while (quedan.size) {
      let elegido = -1, mejorV = -1, mejorP = -1, mejorRegret = -Infinity, mejorCosto = Infinity;
      for (const x of quedan) {
        let c1 = Infinity, c2 = Infinity, v1 = -1, p1 = -1;
        for (let v = 0; v < V; v++) {
          if (!puedeAgregar(v, rutas[v], x)) continue;
          let mejorEnV = Infinity, pEnV = -1;
          for (let p = 0; p <= rutas[v].length; p++) {
            const c = costoInsertar(rutas[v], x, p);
            if (c < mejorEnV && enJornada(v, [...rutas[v].slice(0, p), x, ...rutas[v].slice(p)])) { mejorEnV = c; pEnV = p; }
          }
          if (pEnV < 0) continue;
          if (mejorEnV < c1) { c2 = c1; c1 = mejorEnV; v1 = v; p1 = pEnV; } else if (mejorEnV < c2) c2 = mejorEnV;
        }
        if (v1 < 0) continue;
        const regret = (c2 === Infinity ? 1e12 : c2 - c1);
        if (regret > mejorRegret + EPS || (Math.abs(regret - mejorRegret) <= EPS && c1 < mejorCosto)) {
          elegido = x; mejorV = v1; mejorP = p1; mejorRegret = regret; mejorCosto = c1;
        }
      }
      if (elegido < 0) break; // las que quedan no caben en ninguna móvil
      rutas[mejorV].splice(mejorP, 0, elegido);
      quedan.delete(elegido);
    }
    return Array.from(quedan);
  }

  /** Mejora local hasta que ningún cambio acorte el total. */
  function mejorar(rutas: number[][]) {
    let hubo = true;
    let vueltas = 0;
    while (hubo && vueltas++ < 200) {
      hubo = false;
      // 2-opt dentro de cada ruta: invertir un tramo.
      for (let v = 0; v < V; v++) {
        const r = rutas[v];
        let base = costo(r);
        for (let i = 0; i < r.length - 1; i++) {
          for (let k = i + 1; k < r.length; k++) {
            const prueba = [...r.slice(0, i), ...r.slice(i, k + 1).reverse(), ...r.slice(k + 1)];
            const c = costo(prueba);
            if (c < base - EPS && enJornada(v, prueba)) { r.splice(0, r.length, ...prueba); base = c; hubo = true; }
          }
        }
      }
      // Or-opt: mover un tramo de 2 o 3 paradas seguidas a otro lugar de la misma ruta,
      // en el mismo sentido o al revés.
      for (let v = 0; v < V; v++) {
        for (const largo of [2, 3]) {
          const r = rutas[v];
          if (r.length <= largo) continue;
          let base = costo(r);
          for (let i = 0; i + largo <= r.length; i++) {
            const tramo = r.slice(i, i + largo);
            const resto = [...r.slice(0, i), ...r.slice(i + largo)];
            for (let p = 0; p <= resto.length; p++) {
              if (p === i) continue;
              for (const t of [tramo, [...tramo].reverse()]) {
                const prueba = [...resto.slice(0, p), ...t, ...resto.slice(p)];
                const c = costo(prueba);
                if (c < base - EPS && enJornada(v, prueba)) { r.splice(0, r.length, ...prueba); base = c; hubo = true; }
              }
            }
          }
        }
      }
      // Mover una parada a otra posición (en su móvil o en otra).
      for (let a = 0; a < V; a++) {
        for (let i = 0; i < rutas[a].length; i++) {
          const x = rutas[a][i];
          const sinX = [...rutas[a].slice(0, i), ...rutas[a].slice(i + 1)];
          const ahorro = costo(rutas[a]) - costo(sinX);
          let mejor = 0, bV = -1, bP = -1;
          for (let b = 0; b < V; b++) {
            const destino = b === a ? sinX : rutas[b];
            if (b !== a && !puedeAgregar(b, destino, x)) continue;
            for (let p = 0; p <= destino.length; p++) {
              if (b === a && p === i) continue;
              const gana = ahorro - costoInsertar(destino, x, p);
              if (gana > mejor + EPS && enJornada(b, [...destino.slice(0, p), x, ...destino.slice(p)])) { mejor = gana; bV = b; bP = p; }
            }
          }
          if (bV >= 0) {
            rutas[a] = sinX;
            rutas[bV].splice(bP, 0, x);
            hubo = true;
            i = -1; // la ruta a cambió: se vuelve a recorrer
            if (rutas[a].length === 0) break;
          }
        }
      }
      // Intercambiar dos paradas de móviles distintas.
      for (let a = 0; a < V; a++) {
        for (let b = a + 1; b < V; b++) {
          for (let i = 0; i < rutas[a].length; i++) {
            for (let k = 0; k < rutas[b].length; k++) {
              const ra = [...rutas[a]]; const rb = [...rutas[b]];
              [ra[i], rb[k]] = [rb[k], ra[i]];
              if (!cabe(a, ra) || !cabe(b, rb)) continue;
              if (costo(ra) + costo(rb) < costo(rutas[a]) + costo(rutas[b]) - EPS) {
                rutas[a] = ra; rutas[b] = rb; hubo = true;
              }
            }
          }
        }
      }
    }
  }

  const total = (rutas: number[][]) => rutas.reduce((s, r) => s + costo(r), 0);

  // 1 y 2: la primera solución.
  let mejores: number[][] = Array.from({ length: V }, () => []);
  let sinAsignar = reconstruir(mejores, Array.from({ length: n }, (_, i) => i + 1));
  mejorar(mejores);
  sinAsignar = reconstruir(mejores, sinAsignar);
  let mejorTotal = total(mejores);

  // 3: destruir y reconstruir mientras haya tiempo.
  if (n > 2) {
    const intentos = e.intentos ?? Math.min(800, 150 + n * 20);
    let iter = 0;
    while (iter++ < intentos && Date.now() < tope) {
      const rutas = mejores.map((r) => [...r]);
      const cuantas = Math.max(2, Math.min(n - 1, Math.round(n * (0.15 + azar() * 0.25))));
      const fuera: number[] = [];
      if (azar() < 0.5) {
        // Al azar.
        const todas = rutas.flat();
        while (fuera.length < cuantas && todas.length) fuera.push(todas.splice(Math.floor(azar() * todas.length), 1)[0]);
      } else {
        // Las más cercanas a una parada elegida al azar: rehace un barrio entero.
        const todas = rutas.flat();
        if (!todas.length) break;
        const semilla = todas[Math.floor(azar() * todas.length)];
        todas.sort((x, y) => d[semilla][x] - d[semilla][y]);
        fuera.push(...todas.slice(0, cuantas));
      }
      for (let v = 0; v < V; v++) rutas[v] = rutas[v].filter((x) => !fuera.includes(x));
      const quedan = reconstruir(rutas, [...fuera, ...sinAsignar]);
      mejorar(rutas);
      const t = total(rutas);
      // Primero que entren más paradas; después, menos kilómetros.
      if (quedan.length < sinAsignar.length || (quedan.length === sinAsignar.length && t < mejorTotal - EPS)) {
        mejores = rutas; mejorTotal = t; sinAsignar = quedan;
      }
    }
  }

  const metros = mejores.map(costo);
  return { rutas: mejores, sinAsignar: sinAsignar.sort((a, b) => a - b), metros, total: metros.reduce((s, m) => s + m, 0) };
}

/** Números al azar repetibles (mulberry32). */
function generador(semilla: number) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
