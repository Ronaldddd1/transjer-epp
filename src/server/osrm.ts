import "server-only";
import { haversine } from "@/lib/rutas/geo";

/**
 * Distancias y trazos por las calles, con OSRM (el motor de rutas de OpenStreetMap).
 *
 * Por defecto usa el servidor público de demostración; para un uso más intenso se puede
 * apuntar a uno propio con OSRM_URL. Si no responde, las distancias se estiman en línea
 * recta por un factor (las calles de Lima alargan el camino ~35 %) y el plan queda
 * marcado como aproximado.
 */

const BASE = () => (process.env.OSRM_URL?.trim() || "https://router.project-osrm.org").replace(/\/$/, "");
/** Cuánto más largo es ir por las calles que en línea recta, en promedio, en Lima. */
export const FACTOR_CALLES = 1.35;
/** Velocidad media en ciudad para el tiempo estimado cuando no hay OSRM: 22 km/h. */
const VELOCIDAD_MS = 22_000 / 3600;

export type Punto = { lat: number; lng: number };
export type Matriz = { distancias: number[][]; duraciones: number[][]; aproximada: boolean };

const coords = (puntos: Punto[]) => puntos.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");

/** La matriz de distancias (m) y tiempos (s) entre todos los puntos. */
export async function matriz(puntos: Punto[]): Promise<Matriz> {
  try {
    const res = await fetch(`${BASE()}/table/v1/driving/${coords(puntos)}?annotations=distance,duration`, {
      headers: { "User-Agent": "TransjerGestion/1.0 (rutas de reparto)" },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(String(res.status));
    const j = (await res.json()) as { code: string; distances?: (number | null)[][]; durations?: (number | null)[][] };
    if (j.code !== "Ok" || !j.distances || !j.durations) throw new Error(j.code);
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
 * distancia y tiempo. Si OSRM no responde, líneas rectas entre las paradas.
 */
export async function trazo(puntos: Punto[]): Promise<{ linea: [number, number][]; metros: number; segundos: number; aproximado: boolean }> {
  try {
    const res = await fetch(`${BASE()}/route/v1/driving/${coords(puntos)}?overview=full&geometries=geojson`, {
      headers: { "User-Agent": "TransjerGestion/1.0 (rutas de reparto)" },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(String(res.status));
    const j = (await res.json()) as { code: string; routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[] };
    const r = j.routes?.[0];
    if (j.code !== "Ok" || !r) throw new Error(j.code);
    return { linea: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]), metros: r.distance, segundos: r.duration, aproximado: false };
  } catch {
    let metros = 0;
    for (let i = 1; i < puntos.length; i++) metros += haversine(puntos[i - 1], puntos[i]) * FACTOR_CALLES;
    return { linea: puntos.map((p) => [p.lat, p.lng]), metros, segundos: metros / VELOCIDAD_MS, aproximado: true };
  }
}
