import "server-only";
import { normalizePlate } from "@/lib/utils";

/**
 * Lee los datos del viaje escritos en el concepto de una factura de transporte.
 *
 * El XML de un transportista trae todo el servicio en una sola línea de texto, así:
 *
 *   POR EL SERVICIO DE TRANSPORTE DE CARGA LIMA- LOCAL CON FECHA 13/10/2026
 *   S/G/R/T/E VT01-007988 S/G/R/E/T EG03 - 00000349 CLIENTE TIENDAS PERUANAS SA
 *   CON PLACA BBR-905
 *
 * Ahí dentro está lo que el control de transportes necesita —fecha, ruta, cliente,
 * placa y las dos guías—, y copiarlo a mano en cada factura es media hora al día.
 *
 * Cada dato se busca por su cuenta, no como una plantilla: los transportistas no
 * escriben todos igual, y lo que importa es que falte un dato y no que se pierdan los
 * otros cinco. Lo que no se reconoce queda en null y se completa a mano desde la ficha.
 */

export type ViajeLeido = {
  /** Fecha del servicio, en formato ISO. */
  serviceDate: string | null;
  plate: string | null;
  clientName: string | null;
  originCity: string | null;
  destinationCity: string | null;
  /** Guía de remisión del TRANSPORTISTA (S/G/R/T/E). */
  grtNumber: string | null;
  /** Guía de remisión del REMITENTE (S/G/R/E/T), la del cliente. */
  dispatchNote: string | null;
};

const VACIO: ViajeLeido = {
  serviceDate: null, plate: null, clientName: null,
  originCity: null, destinationCity: null, grtNumber: null, dispatchNote: null,
};

/** Sin tildes y en mayúsculas: "Cliente" y "CLIENTE" son la misma palabra. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** 13/10/2026 → 2026-10-13. Devuelve null si ese día no existe. */
function fechaIso(dia: string, mes: string, anio: string): string | null {
  const d = Number(dia);
  const m = Number(mes);
  const y = Number(anio.length === 2 ? `20${anio}` : anio);
  if (m < 1 || m > 12 || d < 1 || y < 2000 || y > 2100) return null;
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > ultimo) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Número de guía pegado: "EG03 - 00000349" y "EG03-00000349" son la misma guía, y
 * escrita de dos formas no se podría buscar ni comparar.
 */
function guia(texto: string): string {
  return texto.replace(/\s*-\s*/g, "-").replace(/\s+/g, "").slice(0, 40);
}

/** Quita la basura de los bordes: comas, puntos y conectores sueltos. */
function limpiar(texto: string): string {
  return texto.replace(/^[\s,.:;-]+|[\s,.:;-]+$/g, "").trim();
}

/**
 * Lo mismo, pero sin comerse el punto de una razón social.
 *
 * "ALICORP S.A.A." termina en punto y ese punto es parte del nombre; "…PLACA BBR-905."
 * termina en el punto de la frase. Se distinguen porque en el primero el punto viene
 * detrás de una sola letra.
 */
function limpiarNombre(texto: string): string {
  const sinBordes = texto.replace(/^[\s,.:;-]+/, "").replace(/[\s,:;-]+$/, "").trim();
  return /\.[A-Z0-9]\.$/.test(sinBordes) ? sinBordes : sinBordes.replace(/\.+$/, "").trim();
}

/**
 * El formato que se les pide a los proveedores: cada dato con su etiqueta y dos puntos,
 * separados por una barra vertical, en cualquier orden.
 *
 *   SERVICIO DE TRANSPORTE DE CARGA | FECHA: 26/08/2026 | PLACA: C1A-932 |
 *   ORIGEN: LIMA | DESTINO: PIURA | CLIENTE: TIENDAS PERUANAS S.A. |
 *   GRR: EG03-00000349 | GRT: VT01-007988
 *
 * Con etiquetas no hay que adivinar dónde termina el cliente o cuál es el destino: cada
 * valor va desde su etiqueta hasta la siguiente (o hasta la barra).
 */
export { FORMATO_CONCEPTO } from "@/lib/guias";

const ETIQUETAS: [keyof ViajeLeido, string][] = [
  ["serviceDate", "FECHA(?:\\s+(?:DE(?:L)?\\s+)?SERVICIO)?"],
  ["plate", "PLACAS?"],
  ["originCity", "ORIGEN"],
  ["destinationCity", "DESTINO"],
  ["clientName", "CLIENTE"],
  ["dispatchNote", "GRR|GUIA\\s+(?:DE\\s+)?REMITENTE|GUIA\\s+DE\\s+REMISION(?:\\s+REMITENTE)?"],
  ["grtNumber", "GRT|GUIA\\s+(?:DEL?\\s+)?TRANSPORTISTA"],
];

/** Los datos escritos con su etiqueta ("ORIGEN: LIMA"). Solo cuentan los que llevan dos puntos. */
function leerEtiquetas(t: string): Partial<Record<keyof ViajeLeido, string>> {
  const todas = new RegExp(`(?:^|[|\\s])(${ETIQUETAS.map(([, r]) => `(?:${r})`).join("|")})\\s*:`, "g");
  const marcas: { campo: keyof ViajeLeido; desde: number; valorDesde: number }[] = [];
  for (const m of t.matchAll(todas)) {
    const etiqueta = m[1];
    const campo = ETIQUETAS.find(([, r]) => new RegExp(`^(?:${r})$`).test(etiqueta))?.[0];
    if (!campo) continue;
    marcas.push({ campo, desde: m.index!, valorDesde: m.index! + m[0].length });
  }
  const valores: Partial<Record<keyof ViajeLeido, string>> = {};
  marcas.forEach((m, i) => {
    const hasta = i + 1 < marcas.length ? marcas[i + 1].desde : t.length;
    const valor = t.slice(m.valorDesde, hasta).split("|")[0];
    if (!(m.campo in valores)) valores[m.campo] = valor.trim();
  });
  return valores;
}

export function leerConceptoTransporte(concepto: string | null | undefined): ViajeLeido {
  if (!concepto) return { ...VACIO };
  const t = normalizar(concepto);
  const salida: ViajeLeido = { ...VACIO };

  // ---------- Fecha del servicio ----------
  const fecha = t.match(/FECHA\s*:?\s*(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{2,4})/);
  if (fecha) salida.serviceDate = fechaIso(fecha[1], fecha[2], fecha[3]);

  // ---------- Placa ----------
  // Las peruanas son AAA-123 o A1A-123; se admiten con guion, con espacio o pegadas.
  const placa = t.match(/PLACAS?\s*:?\s*(?:N?º?\s*)?([A-Z0-9]{3})\s*-?\s*([A-Z0-9]{3})/);
  if (placa) salida.plate = normalizePlate(`${placa[1]}${placa[2]}`);

  // ---------- Guías ----------
  // S/G/R/T/E es la del transportista y S/G/R/E/T la del remitente: se diferencian solo
  // en el orden de dos letras, así que se buscan exactas y no con un patrón suelto.
  const transportista = t.match(/(?:S\s*\/\s*G\s*\/\s*R\s*\/\s*T\s*\/\s*E|\bGRTE?\b|\bG\.?R\.?T\.?)\s*:?\s*([A-Z0-9]{2,6}\s*-?\s*\d{1,10})/);
  if (transportista) salida.grtNumber = guia(transportista[1]);

  const remitente = t.match(/(?:S\s*\/\s*G\s*\/\s*R\s*\/\s*E\s*\/\s*T|\bGRET?\b|\bGRR\b|\bG\.?R\.?E\.?)\s*:?\s*([A-Z0-9]{2,6}\s*-?\s*\d{1,10})/);
  if (remitente) salida.dispatchNote = guia(remitente[1]);

  // ---------- Cliente ----------
  // Va desde la palabra CLIENTE hasta lo siguiente que se reconoce (la placa, una guía o
  // el final). Sin ese tope, el nombre del cliente se tragaría el resto de la línea.
  const cliente = t.match(/CLIENTE\s*:?\s*(.+?)(?=\s*\||\s+(?:CON\s+PLACA|PLACAS?\b|S\s*\/\s*G\s*\/\s*R|G\.?R\.?[TER]|CON\s+FECHA|FECHA\b|ORIGEN\b|DESTINO\b|GUIA\b)|$)/);
  if (cliente) {
    const nombre = limpiarNombre(cliente[1]);
    if (nombre.length > 1) salida.clientName = nombre.slice(0, 120);
  }

  // ---------- Ruta ----------
  // "LIMA- LOCAL", "LIMA - AREQUIPA", "DE LIMA A PIURA". Se mira el tramo que va después
  // de CARGA (o de TRANSPORTE) y antes de la fecha, que es donde la escriben todos.
  const tramo = t.match(/(?:TRANSPORTE\s+DE\s+CARGA|TRANSPORTE|CARGA|FLETE)\s+(.+?)(?=\s+(?:CON\s+FECHA|FECHA\b|S\s*\/\s*G|G\.?R\.?[TE]|CLIENTE\b|CON\s+PLACA|PLACAS?\b)|$)/);
  if (tramo) {
    const ruta = limpiar(tramo[1]);
    const partes = ruta.split(/\s*(?:-|–|\/|\bA\b|\bHACIA\b|\bHASTA\b)\s*/)
      // "DE LIMA" es LIMA: el conector se escribe pegado al nombre y si no se quita, el
      // origen quedaría guardado como "DE LIMA" y no cruzaría con nada.
      .map((parte) => limpiar(parte).replace(/^DE\s+/, ""))
      .filter(Boolean);
    // Un solo pedazo no es una ruta, y un pedazo con números tampoco: ahí lo que quedó
    // atrapado es una placa o una guía, no una ciudad.
    const esLugar = (x: string) => x.length > 1 && !/\d/.test(x);
    if (partes.length >= 2 && esLugar(partes[0]) && esLugar(partes[1])) {
      salida.originCity = partes[0].slice(0, 80);
      salida.destinationCity = partes[1].slice(0, 120);
    }
  }

  // ---------- Lo escrito con etiqueta manda ----------
  // Si el proveedor usó el formato (ORIGEN:, DESTINO:, CLIENTE:…), esos valores valen más
  // que lo adivinado del texto libre.
  const e = leerEtiquetas(t);
  if (e.serviceDate) {
    const f = e.serviceDate.match(/(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{2,4})/);
    if (f) salida.serviceDate = fechaIso(f[1], f[2], f[3]) ?? salida.serviceDate;
  }
  if (e.plate) {
    const pl = e.plate.match(/([A-Z0-9]{3})\s*-?\s*([A-Z0-9]{3})/);
    if (pl) salida.plate = normalizePlate(`${pl[1]}${pl[2]}`);
  }
  if (e.originCity && limpiar(e.originCity).length > 1) salida.originCity = limpiar(e.originCity).slice(0, 80);
  if (e.destinationCity && limpiar(e.destinationCity).length > 1) salida.destinationCity = limpiar(e.destinationCity).slice(0, 120);
  if (e.clientName && limpiarNombre(e.clientName).length > 1) salida.clientName = limpiarNombre(e.clientName).slice(0, 120);
  if (e.dispatchNote && /\d/.test(e.dispatchNote)) salida.dispatchNote = guia(e.dispatchNote.split(/\s+(?=[A-Z]{3,}\b)/)[0]);
  if (e.grtNumber && /\d/.test(e.grtNumber)) salida.grtNumber = guia(e.grtNumber.split(/\s+(?=[A-Z]{3,}\b)/)[0]);

  return salida;
}

/** Si el concepto tiene pinta de ser un viaje. Se usa para proponer el tipo al aprobar. */
export function pareceTransporte(concepto: string | null | undefined): boolean {
  if (!concepto) return false;
  const t = normalizar(concepto);
  return /\b(TRANSPORTE|FLETE|VIAJE|CARGA)\b/.test(t)
    || /PLACAS?\s/.test(t)
    || /S\s*\/\s*G\s*\/\s*R/.test(t);
}
