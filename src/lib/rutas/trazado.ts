/**
 * Pedir a OSRM (el motor de rutas de OpenStreetMap) el camino por las calles entre varios
 * puntos. Lo usan el servidor (al calcular) y el navegador (para redibujar una ruta que
 * quedó en línea recta porque el servidor no obtuvo respuesta).
 *
 * Se prueban varios servidores públicos, cada uno con un reintento: el de demostración de
 * OSRM a veces rechaza o corta (sobre todo pedidos seguidos desde la nube).
 */

export const OSRM_PUBLICOS = ["https://router.project-osrm.org", "https://routing.openstreetmap.de/routed-car"];

export type Camino = { linea: [number, number][]; metros: number; segundos: number };

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Los servidores a usar: el propio (si se configuró) o los públicos. */
export function servidoresOsrm(propio?: string | null) {
  const p = propio?.trim();
  return p ? [p.replace(/\/$/, "")] : OSRM_PUBLICOS;
}

/** GET a OSRM probando cada servidor (y reintentando una vez cada uno). */
export async function pedirOsrm<T extends { code: string }>(
  servidores: string[], ruta: string, opciones: { headers?: Record<string, string>; timeoutMs?: number; pausaMs?: number } = {},
): Promise<T> {
  let ultimo: unknown = new Error("sin servidores");
  for (const base of servidores) {
    for (let intento = 0; intento < 2; intento++) {
      try {
        const res = await fetch(`${base}${ruta}`, {
          headers: opciones.headers,
          signal: AbortSignal.timeout(opciones.timeoutMs ?? 20_000),
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = (await res.json()) as T;
        if (j.code !== "Ok") throw new Error(j.code);
        return j;
      } catch (e) {
        ultimo = e;
        if (intento === 0) await espera(opciones.pausaMs ?? 1200);
      }
    }
  }
  throw ultimo;
}

const coords = (puntos: [number, number][]) => puntos.map(([lat, lng]) => `${lng.toFixed(6)},${lat.toFixed(6)}`).join(";");

/** El camino por las calles que pasa por los puntos en orden ([lat, lng]). */
export async function caminoPorCalles(
  servidores: string[], puntos: [number, number][], opciones: { headers?: Record<string, string>; timeoutMs?: number; pausaMs?: number } = {},
): Promise<Camino> {
  const j = await pedirOsrm<{ code: string; routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[] }>(
    servidores, `/route/v1/driving/${coords(puntos)}?overview=full&geometries=geojson`, opciones,
  );
  const r = j.routes?.[0];
  if (!r || r.geometry.coordinates.length < 2) throw new Error("sin ruta");
  return { linea: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]), metros: r.distance, segundos: r.duration };
}

/**
 * Si un trazo guardado es solo la unión en línea recta de sus paradas (centro, entregas,
 * cochera; los planes anteriores empezaban además en la cochera): un camino por las calles
 * siempre tiene muchos más puntos.
 */
export function esTrazoRecto(linea: [number, number][] | null | undefined, entregas: number) {
  return !!linea && linea.length >= 2 && linea.length <= entregas + 3;
}
