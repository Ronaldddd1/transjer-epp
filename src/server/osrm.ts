import "server-only";
import { haversine } from "@/lib/rutas/geo";
import { caminoPorCalles, pedirOsrm, servidoresOsrm } from "@/lib/rutas/trazado";

/**
 * Distancias y trazos por las calles, con OSRM (el motor de rutas de OpenStreetMap).
 *
 * Por defecto usa los servidores públicos (con reintento y un segundo servidor de respaldo); para un uso más intenso se puede
 * apuntar a uno propio con OSRM_URL. Si no responde, las distancias se estiman en línea
 * recta por un factor (las calles de Lima alargan el camino ~35 %) y el plan queda
 * marcado como aproximado.
 */

const SERVIDORES = () => servidoresOsrm(process.env.OSRM_URL);
const CABECERAS = { "User-Agent": "TransjerGestion/1.0 (rutas de reparto)" };
/** Cuánto más largo es ir por las calles que en línea recta, en promedio, en Lima. */
export const FACTOR_CALLES = 1.35;
/** Velocidad media en ciudad para el tiempo estimado cuando no hay OSRM: 22 km/h. */
export const VELOCIDAD_MS = 22_000 / 3600;

export type Punto = { lat: number; lng: number };
export type Matriz = { distancias: number[][]; duraciones: number[][]; aproximada: boolean };

const coords = (puntos: Punto[]) => puntos.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");

/** La matriz de distancias (m) y tiempos (s) entre todos los puntos. */
export async function matriz(puntos: Punto[]): Promise<Matriz> {
  try {
    const j = await pedirOsrm<{ code: string; distances?: (number | null)[][]; durations?: (number | null)[][] }>(
      SERVIDORES(), `/table/v1/driving/${coords(puntos)}?annotations=distance,duration`, { headers: CABECERAS, timeoutMs: 9_000, pausaMs: 800 },
    );
    if (!j.distances || !j.durations) throw new Error("sin matriz");
    // Un par sin camino (null) se completa con la estimación en línea recta.
    const distancias = j.distances.map((fila, i) => fila.map((d, k) => d ?? haversine(puntos[i], puntos[k]) * FACTOR_CALLES));
    const duraciones = j.durations.map((fila, i) => fila.map((d, k) => d ?? distancias[i][k] / VELOCIDAD_MS));
    return { distancias, duraciones, aproximada: false };
  } catch {
    return matrizAproximada(puntos);
  }
}

export function matrizAproximada(puntos: Punto[]): Matriz {
  const distancias = puntos.map((a) => puntos.map((b) => haversine(a, b) * FACTOR_CALLES));
  return { distancias, duraciones: distancias.map((f) => f.map((d) => d / VELOCIDAD_MS)), aproximada: true };
}

/**
 * El trazo de una ruta por las calles, en orden: [lat, lng][] para el mapa, con su
 * distancia y tiempo. Si OSRM no responde (o con soloRecta, cuando ya no queda tiempo),
 * líneas rectas entre las paradas: el navegador las vuelve a pedir y las redibuja.
 */
export async function trazo(puntos: Punto[], soloRecta = false): Promise<{ linea: [number, number][]; metros: number; segundos: number; aproximado: boolean }> {
  try {
    if (soloRecta) throw new Error("sin consulta");
    const c = await caminoPorCalles(SERVIDORES(), puntos.map((p) => [p.lat, p.lng]), { headers: CABECERAS, timeoutMs: 9_000, pausaMs: 800 });
    return { ...c, aproximado: false };
  } catch {
    let metros = 0;
    for (let i = 1; i < puntos.length; i++) metros += haversine(puntos[i - 1], puntos[i]) * FACTOR_CALLES;
    return { linea: puntos.map((p) => [p.lat, p.lng]), metros, segundos: metros / VELOCIDAD_MS, aproximado: true };
  }
}
