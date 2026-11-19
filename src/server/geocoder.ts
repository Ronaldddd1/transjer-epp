import "server-only";
import { candidatos, dentroDeLima, enDistrito, titulo, type Calidad } from "@/lib/rutas/geo";

/**
 * Ubica direcciones con OpenStreetMap (Nominatim).
 *
 * Nominatim es gratis, pero pide respetar su uso: una consulta por segundo como máximo,
 * y que cada consulta diga quién la hace. Para unas decenas de paradas al día es de sobra.
 * Si alguna vez se quiere un servidor propio u otro compatible, basta con GEOCODER_URL.
 */

const BASE = () => (process.env.GEOCODER_URL?.trim() || "https://nominatim.openstreetmap.org").replace(/\/$/, "");
const ESPERA_MS = () => Number(process.env.GEOCODER_DELAY_MS ?? 1100);

type Respuesta = {
  lat: string; lon: string; display_name: string; boundingbox?: [string, string, string, string];
  address?: Record<string, string>;
};

let ultima = 0;
async function consultar(q: string): Promise<Respuesta[]> {
  // Una por segundo, aunque se llame seguido.
  const falta = ultima + ESPERA_MS() - Date.now();
  if (falta > 0) await new Promise((r) => setTimeout(r, falta));
  ultima = Date.now();
  const url = new URL(`${BASE()}/search`);
  url.searchParams.set("q", q);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("countrycodes", "pe");
  url.searchParams.set("limit", "5");
  url.searchParams.set("accept-language", "es");
  if (process.env.GEOCODER_EMAIL) url.searchParams.set("email", process.env.GEOCODER_EMAIL);
  const res = await fetch(url, {
    headers: { "User-Agent": "TransjerGestion/1.0 (rutas de reparto)" },
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`El buscador de direcciones respondió ${res.status}`);
  return (await res.json()) as Respuesta[];
}

/** El recuadro del distrito, para aceptar resultados que no lo nombran pero caen adentro. */
const recuadros = new Map<string, [number, number, number, number] | null>();
async function recuadroDe(distrito: string) {
  if (recuadros.has(distrito)) return recuadros.get(distrito)!;
  let caja: [number, number, number, number] | null = null;
  try {
    const [r] = await consultar(`${titulo(distrito)}, Lima, Peru`);
    if (r?.boundingbox) caja = r.boundingbox.map(Number) as [number, number, number, number];
  } catch { /* sin recuadro: se valida por nombre */ }
  recuadros.set(distrito, caja);
  return caja;
}

export type Ubicacion = { lat: number; lng: number; calidad: Calidad; etiqueta: string; consulta: string };

/**
 * Ubica una dirección probando de la búsqueda más precisa a la más general, y se queda
 * con la primera que cae en el distrito correcto. Devuelve null si ni el distrito se
 * encontró (sin conexión con el buscador, por ejemplo).
 */
export async function geocodificar(direccionLimpia: string, distrito: string): Promise<Ubicacion | null> {
  const caja = await recuadroDe(distrito);
  for (const c of candidatos(direccionLimpia, distrito)) {
    let resultados: Respuesta[];
    try {
      resultados = await consultar(c.consulta);
    } catch {
      return null;
    }
    for (const r of resultados) {
      const lat = Number(r.lat);
      const lng = Number(r.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !dentroDeLima(lat, lng)) continue;
      const partes = Object.values(r.address ?? {});
      if (c.calidad !== "DISTRITO" && !enDistrito({ lat, lng, partes }, distrito, caja)) continue;
      // "EXACTA" solo si el buscador encontró el número; si no, es la calle.
      const calidad: Calidad = c.calidad === "EXACTA" && !r.address?.house_number ? "CALLE" : c.calidad;
      return { lat, lng, calidad, etiqueta: r.display_name.slice(0, 400), consulta: c.consulta };
    }
  }
  return null;
}
