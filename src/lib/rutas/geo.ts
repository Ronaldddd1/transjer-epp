import { normalizar } from "./programacion";

/**
 * Lo que no depende de la red para ubicar una dirección: qué buscar, en qué orden, y si
 * lo que devolvió el buscador está donde tiene que estar.
 */

export type Calidad = "EXACTA" | "CALLE" | "ZONA" | "DISTRITO" | "MANUAL" | "SIN_UBICAR";

export const CALIDAD_LABEL: Record<Calidad, string> = {
  EXACTA: "Exacta",
  CALLE: "A nivel de calle",
  ZONA: "Por la urbanización",
  DISTRITO: "Solo el distrito",
  MANUAL: "Corregida a mano",
  SIN_UBICAR: "Sin ubicar",
};

/** Las que conviene revisar en el mapa antes de calcular: no se sabe la cuadra. */
export const esAproximada = (c: Calidad | string | null | undefined) => c === "ZONA" || c === "DISTRITO" || c === "SIN_UBICAR" || !c;

/** Lima Metropolitana y Callao, con margen: lo que caiga afuera es un error del buscador. */
export const LIMA = { sur: -12.62, norte: -11.55, oeste: -77.3, este: -76.6 };
export const dentroDeLima = (lat: number, lng: number) =>
  lat >= LIMA.sur && lat <= LIMA.norte && lng >= LIMA.oeste && lng <= LIMA.este;

const ABREVIATURAS: [RegExp, string][] = [
  [/^AV\.?\s/, "AVENIDA "], [/^JR\.?\s/, "JIRON "], [/^CA\.?\s/, "CALLE "], [/^PSJE\.?\s/, "PASAJE "],
  [/^PJE\.?\s/, "PASAJE "], [/^PROL\.?\s/, "PROLONGACION "], [/^CAL\.?\s/, "CALLE "],
];

export type Candidato = { consulta: string; calidad: Exclude<Calidad, "MANUAL" | "SIN_UBICAR"> };

/**
 * Las búsquedas para una dirección, de la más precisa a la más general.
 *
 *  1. La vía y el número: "AVENIDA TOMAS MARSANO 397, SURQUILLO".
 *  2. Solo la vía: "AVENIDA TOMAS MARSANO, SURQUILLO" (OpenStreetMap tiene pocas
 *     numeraciones en Lima; la calle ya sirve para la ruta).
 *  3. La urbanización o asociación: "VILLA SOL NACIENTE, SAN JUAN DE LURIGANCHO" (para
 *     las direcciones de manzana y lote, que no tienen calle).
 *  4. El distrito: queda marcada para revisar.
 */
export function candidatos(direccionLimpia: string, distrito: string): Candidato[] {
  let d = normalizar(direccionLimpia);
  for (const [re, por] of ABREVIATURAS) d = d.replace(re, por);
  const lugar = `${titulo(distrito)}, Lima, Peru`;
  const lista: Candidato[] = [];

  // Manzana y lote: no hay vía que buscar.
  const esMzLote = /^(MZ|MZA|MAZ|MANZANA)\b/.test(d) || /\b(MZ|MZA|MAZ)\b.*\b(LT|LOT|LOTE)\b/.test(d);
  const via = esMzLote ? null : d.match(/^(.*?\D)\s(\d{1,5})\b/);
  if (via) {
    lista.push({ consulta: `${titulo(via[1])} ${via[2]}, ${lugar}`, calidad: "EXACTA" });
    lista.push({ consulta: `${titulo(via[1])}, ${lugar}`, calidad: "CALLE" });
  } else if (!esMzLote) {
    const soloVia = d.split(/\s-\s|\bPISO\b|\bDPTO\b|\bINT\b/)[0].trim();
    if (soloVia.length > 3) lista.push({ consulta: `${titulo(soloVia)}, ${lugar}`, calidad: "CALLE" });
  }
  const zona = d.match(/\b(?:URBANIZACION|URB\.?|ASOCIACION|ASOCIA|AAHH|A\.H\.|COOPERATIVA|ASENTAMIENTO HUMANO)\s+([A-Z][A-Z ]{3,}?)(?=\s\d|\s-|$|\sMZ|\sLT)/);
  if (zona) lista.push({ consulta: `${titulo(zona[1].trim())}, ${lugar}`, calidad: "ZONA" });
  lista.push({ consulta: lugar, calidad: "DISTRITO" });
  return lista.filter((c, i, arr) => arr.findIndex((x) => x.consulta === c.consulta) === i);
}

/** "SAN JUAN DE LURIGANCHO" → "San Juan de Lurigancho": los buscadores lo prefieren así. */
export function titulo(v: string) {
  const menores = new Set(["DE", "DEL", "LA", "LAS", "LOS", "EL", "Y"]);
  return normalizar(v).toLowerCase().split(" ").map((w, i) =>
    i > 0 && menores.has(w.toUpperCase()) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/**
 * ¿El resultado está en el distrito que dice el pedido?
 *
 * El buscador a veces devuelve una calle con el mismo nombre en otro distrito (hay una
 * "Avenida Los Álamos" en media Lima). Se acepta solo si alguno de los datos de su
 * dirección nombra el distrito, o si cae dentro del recuadro del distrito buscado.
 */
export function enDistrito(
  resultado: { lat: number; lng: number; partes: string[] },
  distrito: string,
  recuadro?: [number, number, number, number] | null,
) {
  if (!dentroDeLima(resultado.lat, resultado.lng)) return false;
  const buscado = normalizar(distrito).replace(/^CERCADO DE /, "");
  const partes = resultado.partes.map((p) => normalizar(p).replace(/^CERCADO DE /, ""));
  if (partes.some((p) => p === buscado || p === `DISTRITO DE ${buscado}`)) return true;
  if (recuadro) {
    const [sur, norte, oeste, este] = recuadro;
    return resultado.lat >= sur && resultado.lat <= norte && resultado.lng >= oeste && resultado.lng <= este;
  }
  return false;
}

/** Distancia en línea recta entre dos puntos, en metros. */
export function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
