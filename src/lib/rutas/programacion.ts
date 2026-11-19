/**
 * La programación del cliente: el Excel que manda cada tarde con lo que hay que repartir
 * al día siguiente, convertido en paradas.
 *
 * El Excel trae una fila por producto ("LISTA DE PEDIDOS FINAL"). Para la ruta lo que
 * importa es a dónde hay que ir: los productos de un mismo pedido van juntos, y dos
 * pedidos para la misma dirección son una sola parada (se suman el peso y el volumen).
 *
 * Las columnas se buscan por su nombre, no por su posición: si el cliente agrega o mueve
 * una columna, el archivo se sigue leyendo.
 */

export type Producto = { codigo: string; descripcion: string; cantidad: number };

export type Parada = {
  /** Clave de la dirección: lo que hace que dos pedidos sean la misma parada. */
  clave: string;
  pedidos: string[];
  cliente: string;
  telefono: string | null;
  direccion: string;
  /** La dirección ordenada para buscarla en el mapa ("CALLE NARANJAL 115 URB CAMACHO"). */
  direccionLimpia: string;
  /** Lo que viene después de la dirección: "POR PORTON DE JICAMARCA", "FRENTE AL…". */
  referencia: string | null;
  distrito: string;
  provincia: string;
  tipoDespacho: string | null;
  agencia: string | null;
  observacion: string | null;
  zona: string | null;
  corte: string | null;
  /** La fecha máxima de entrega más temprana de sus pedidos (aaaa-mm-dd). */
  fechaMax: string | null;
  kg: number;
  m3: number;
  productos: Producto[];
};

const sinTildes = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "");
export const normalizar = (v: unknown) => sinTildes(String(v ?? "")).toUpperCase().replace(/\s+/g, " ").trim();

/** Las columnas que se usan, con los nombres con que pueden venir. */
const COLUMNAS = {
  corte: ["CORTE"],
  pedido: ["PEDIDO", "N PEDIDO", "NRO PEDIDO"],
  cliente: ["NOMBRE CLIENTE", "CLIENTE"],
  telefono: ["TELEFONOS", "TELEFONO", "CELULAR"],
  tipoDespacho: ["TIPO DESPACHO"],
  direccion: ["DIRECCION SUCURSAL", "DIRECCION", "DIRECCION DE ENTREGA"],
  distrito: ["DISTRITO"],
  provincia: ["POBLACION SUCURSAL", "PROVINCIA"],
  codigo: ["CODIGO PRODUCTO", "CODIGO"],
  descripcion: ["DESCRIPCION PRODUCTO", "DESCRIPCION"],
  observacion: ["OBSERVACION", "OBSERVACIONES"],
  agencia: ["AGENCIA"],
  distritoAgencia: ["DISTRITO AGENCIA"],
  cantidad: ["CANTIDAD PEDIDO", "CANTIDAD"],
  kg: ["PESO (KG.)", "PESO (KG)", "PESO KG", "PESO"],
  m3: ["VOLUMEN M3", "VOLUMEN"],
  zona: ["ZONA"],
  fechaMax: ["FECHA_MAX_ENTREGA OPL", "FECHA MAX ENTREGA", "FECHA_MAX_ENTREGA"],
} as const;

type Campo = keyof typeof COLUMNAS;

/** Encuentra la fila de títulos y la posición de cada columna. */
export function ubicarColumnas(filas: unknown[][]): { fila: number; pos: Partial<Record<Campo, number>> } | null {
  for (let f = 0; f < Math.min(filas.length, 15); f++) {
    const titulos = (filas[f] ?? []).map((v) => normalizar(v));
    const pos: Partial<Record<Campo, number>> = {};
    for (const campo of Object.keys(COLUMNAS) as Campo[]) {
      // Primero la coincidencia exacta; "DISTRITO" no debe tomar "DISTRITO AGENCIA".
      const i = COLUMNAS[campo].map((n) => titulos.indexOf(n)).find((x) => x >= 0);
      if (i !== undefined) pos[campo] = i;
    }
    if (pos.pedido !== undefined && pos.direccion !== undefined && pos.distrito !== undefined) return { fila: f, pos };
  }
  return null;
}

const numero = (v: unknown) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const texto = (v: unknown) => {
  const t = String(v ?? "").replace(/ /g, " ").trim();
  return t ? t : null;
};

function fecha(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const t = texto(v);
  if (!t) return null;
  const m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null;
}

const PREFIJOS = [
  "AVENIDA", "AV.", "AV", "CALLE", "JIRON", "JR.", "JR", "PASAJE", "PSJE.", "PSJE", "MALECON", "PROLONGACION",
  "CARRETERA", "ALAMEDA",
];
const PALABRAS = [
  "URBANIZACION", "URB.", "URB", "ASOCIACION", "ASOCIA", "MZA.", "MZA", "MZ.", "MZ", "MAZ", "LOTE", "LOT", "LT.", "LT",
  "INTERIOR", "INT.", "DPTO.", "DPTO", "DEPARTAMENTO", "CASA", "PISO", "SECTOR", "ETAPA", "COOPERATIVA",
  "AAHH", "A.H.", "ASENTAMIENTO",
];
/** Lo que empieza la referencia, que no sirve para ubicar la dirección pero sí al conductor. */
const REFERENCIA = /\s(POR\s|FRENTE\s|FTE\.?\s|ALT\.?\s|ALTURA\s|A\s+\d+\s*(?:MTS|METROS|CUADRAS)|REF\.?\s|REFERENCIA|CERCA\s|ESPALDA\s|COSTADO\s|AL\s+LADO\s)/;

/**
 * Ordena una dirección escrita a la carrera para que un buscador de mapas la entienda.
 *
 *   "CALLENARANJAL115URB CAMACHO"                → "CALLE NARANJAL 115 URB CAMACHO"
 *   "AVENIDA TOMÁS MARSANO 397AVENIDA TOMÁS…397"  → "AVENIDA TOMAS MARSANO 397"
 *   "CALLEBATALLÓN LIBRES DE TRUJILLO 218218URB…" → "CALLE BATALLON LIBRES DE TRUJILLO 218 URB…"
 *
 * Lo que viene después ("POR PORTON DE JICAMARCA", "FRENTE AL SIAN") se separa como
 * referencia: es útil para el conductor, pero confunde al buscador.
 */
export function limpiarDireccion(original: string): { direccion: string; referencia: string | null } {
  let d = normalizar(original).replace(/[‐-―]/g, "-");
  // El cliente a veces pega la dirección dos veces seguidas.
  const mitad = d.length / 2;
  if (Number.isInteger(mitad) && d.slice(0, mitad) === d.slice(mitad)) d = d.slice(0, mitad);
  for (let corte = Math.floor(d.length / 2) - 2; corte <= Math.ceil(d.length / 2) + 2; corte++) {
    const a = d.slice(0, corte).trim();
    if (a.length > 8 && d.slice(corte).trim().startsWith(a)) { d = a + d.slice(corte).trim().slice(a.length); break; }
  }
  // Prefijo pegado al nombre: "CALLENARANJAL" → "CALLE NARANJAL". Se mira palabra por
  // palabra y con el prefijo más largo primero: "AVENIDA" no se parte en "AV ENIDA".
  const largos = [...PREFIJOS].sort((x, y) => y.length - x.length);
  d = d.split(" ").map((palabra) => {
    const p = largos.find((x) => palabra.startsWith(x));
    if (!p || palabra === p || PREFIJOS.includes(palabra.replace(/\d.*$/, ""))) return palabra;
    return /^[A-Z]/.test(palabra.slice(p.length)) ? `${p} ${palabra.slice(p.length)}` : palabra;
  }).join(" ");
  // "VALENTINPOR EL CANAL": la referencia pegada a la última palabra de la dirección.
  d = d.replace(/([A-Z]{6,})(POR|FRENTE)(?=\s)/g, "$1 $2");
  // Letras y números pegados: "NARANJAL115URB" → "NARANJAL 115 URB"; "LOT1" queda "LOT 1".
  d = d.replace(/([A-Z])(\d)/g, "$1 $2").replace(/(\d)([A-Z]{2,})/g, "$1 $2");
  // Palabras de la dirección pegadas a la siguiente: "218URBANIZACION" ya se separó arriba;
  // "URBANIZACIONSANTA" no es común, pero sí "N°701".
  d = d.replace(/N\s*°\s*/g, "").replace(/\bNRO\.?\s*/g, "").replace(/#\s*/g, "");
  // Un número repetido pegado: "218218" → "218" (cuando las dos mitades son iguales).
  d = d.replace(/\b(\d{2,5})\1\b/g, "$1");
  // "000" sueltos que deja el sistema del cliente.
  d = d.replace(/\b0{2,}\b/g, " ");
  for (const p of PALABRAS) {
    const sinPunto = p.replace(".", "\\.");
    d = d.replace(new RegExp(`(\\S)(${sinPunto})(?=\\s|\\d|$)`, "g"), (m, antes, palabra) => (/[A-Z]/.test(antes) && palabra.length < 4 ? m : `${antes} ${palabra}`));
  }
  d = d.replace(/\s*-\s*/g, " - ").replace(/\s+/g, " ").trim();
  // Palabras repetidas seguidas: "141 141 CASA CASA" → "141 CASA".
  d = d.split(" ").filter((w, i, arr) => i === 0 || w !== arr[i - 1]).join(" ");

  let referencia: string | null = null;
  const r = d.match(REFERENCIA);
  if (r && r.index !== undefined && r.index > 6) {
    referencia = d.slice(r.index).trim();
    d = d.slice(0, r.index).trim();
  }
  d = d.replace(/[\s,-]+$/g, "").trim();
  return { direccion: d, referencia };
}

/** La clave de una parada: misma dirección y mismo distrito, aunque esté escrita distinto. */
export const claveDireccion = (direccionLimpia: string, distrito: string) =>
  `${direccionLimpia.replace(/[^A-Z0-9]/g, "")}|${normalizar(distrito)}`;

/**
 * Convierte las filas de la hoja en paradas.
 *
 * Devuelve también lo que no se pudo leer (filas sin dirección o sin pedido), para
 * mostrarlo en vez de perderlo en silencio.
 */
export function leerProgramacion(filas: unknown[][]): { paradas: Parada[]; descartadas: number; error: string | null } {
  const cab = ubicarColumnas(filas);
  if (!cab) {
    return { paradas: [], descartadas: 0, error: "No se encontró la hoja con las columnas Pedido, Dirección y Distrito." };
  }
  const { pos } = cab;
  const v = (fila: unknown[], c: Campo) => (pos[c] === undefined ? undefined : fila[pos[c]!]);
  const porClave = new Map<string, Parada>();
  let descartadas = 0;

  for (const fila of filas.slice(cab.fila + 1)) {
    if (!fila || fila.every((x) => x === null || x === undefined || String(x).trim() === "")) continue;
    const pedido = texto(v(fila, "pedido"));
    const direccion = texto(v(fila, "direccion"));
    const distrito = texto(v(fila, "distrito"));
    if (!pedido || !direccion || !distrito || /^total/i.test(pedido)) { descartadas++; continue; }

    const { direccion: limpia, referencia } = limpiarDireccion(direccion);
    const clave = claveDireccion(limpia, distrito);
    let p = porClave.get(clave);
    if (!p) {
      p = {
        clave, pedidos: [], cliente: texto(v(fila, "cliente")) ?? "—",
        telefono: texto(v(fila, "telefono")),
        direccion, direccionLimpia: limpia, referencia,
        distrito: normalizar(distrito), provincia: normalizar(texto(v(fila, "provincia")) ?? "LIMA"),
        tipoDespacho: texto(v(fila, "tipoDespacho")), agencia: texto(v(fila, "agencia")),
        observacion: texto(v(fila, "observacion")), zona: texto(v(fila, "zona")), corte: texto(v(fila, "corte")),
        fechaMax: null, kg: 0, m3: 0, productos: [],
      };
      porClave.set(clave, p);
    }
    if (!p.pedidos.includes(pedido)) {
      p.pedidos.push(pedido);
      // Si son de clientes distintos (dos pedidos a la misma dirección), se nombran los dos.
      const cliente = texto(v(fila, "cliente"));
      if (cliente && !p.cliente.split(" / ").includes(cliente)) p.cliente = `${p.cliente} / ${cliente}`;
    }
    p.kg += numero(v(fila, "kg"));
    p.m3 += numero(v(fila, "m3"));
    const f = fecha(v(fila, "fechaMax"));
    if (f && (!p.fechaMax || f < p.fechaMax)) p.fechaMax = f;
    const desc = texto(v(fila, "descripcion"));
    if (desc) p.productos.push({ codigo: texto(v(fila, "codigo")) ?? "", descripcion: desc, cantidad: numero(v(fila, "cantidad")) || 1 });
  }

  const paradas = Array.from(porClave.values()).map((p) => ({
    ...p, kg: Math.round(p.kg * 100) / 100, m3: Math.round(p.m3 * 10000) / 10000,
  }));
  return { paradas, descartadas, error: paradas.length ? null : "La hoja no trae pedidos con dirección." };
}
