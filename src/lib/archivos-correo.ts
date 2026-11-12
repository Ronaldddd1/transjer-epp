/**
 * Qué archivos trae un correo de comprobante y cuáles faltan.
 *
 * Un comprobante completo llega con cuatro cosas: la factura (el PDF), su XML, la guía de
 * remisión del remitente y la guía del transportista. El sistema solo puede saber qué es cada archivo por su nombre, así que se usa
 * lo que SUNAT pone en los nombres (RUC-TIPO-SERIE-NÚMERO, donde 01 es factura, 07 nota
 * de crédito, 09 guía del remitente y 31 guía del transportista) y las palabras con las
 * que se suelen nombrar a mano ("guia", "remision", "factura").
 */

export type ArchivoCorreo = { filename: string; contentType?: string | null };
export type TipoArchivo =
  | "XML" | "GUIA_REMITENTE" | "GUIA_TRANSPORTISTA" | "NOTA_CREDITO" | "COMPROBANTE" | "COMPRIMIDO" | "OTRO";

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function clasificarArchivo(a: ArchivoCorreo): TipoArchivo {
  const n = sinTildes(a.filename);
  const tipo = (a.contentType ?? "").toLowerCase();
  if (n.endsWith(".xml") || tipo.includes("xml")) return "XML";
  if (n.endsWith(".zip") || n.endsWith(".rar") || tipo.includes("zip")) return "COMPRIMIDO";
  const esDocumento = /\.(pdf|jpe?g|png|webp|heic|tiff?)$/.test(n) || tipo.includes("pdf") || tipo.startsWith("image/");
  if (!esDocumento) return "OTRO";
  // "…-31-EG03-110.pdf": el tipo de SUNAT, después la serie de 4 y el número.
  const tipoSunat = /(^|[^0-9])(\d{2})-[a-z0-9]{4}-\d+/.exec(n)?.[2];
  // La del transportista se reconoce por el 31 de SUNAT o porque lo dice el nombre; una
  // "guía" o "guía de remisión" sin más es la del remitente.
  if (tipoSunat === "31" || /transportista|\bgrt\b/.test(n)) return "GUIA_TRANSPORTISTA";
  if (tipoSunat === "09" || /guia|remision|remitente|\bgrr?\b/.test(n)) return "GUIA_REMITENTE";
  if (tipoSunat === "07" || /nota.?(de.?)?credito|\bnc\b/.test(n)) return "NOTA_CREDITO";
  return "COMPROBANTE";
}

export const FALTA_XML = "No se encontró el XML del comprobante entre los archivos.";
export const XML_ILEGIBLE = "El XML adjunto no se pudo leer.";
export const FALTA_FACTURA = "No se encontró la factura (PDF) entre los archivos.";
export const FALTA_GUIA = "No se encontró la guía de remisión entre los archivos.";
export const FALTA_GUIA_TRANSPORTISTA = "No se encontró la guía transportista entre los archivos.";
export const SIN_ADJUNTOS = "El correo no trae archivos adjuntos.";

/** El nombre corto de cada faltante, para mostrarlos juntos en una línea. */
export const FALTANTE_CORTO: Record<string, string> = {
  [FALTA_XML]: "XML",
  [XML_ILEGIBLE]: "XML legible",
  [FALTA_FACTURA]: "Factura (PDF)",
  [FALTA_GUIA]: "Guía de remisión",
  [FALTA_GUIA_TRANSPORTISTA]: "Guía transportista",
};

/**
 * Un número de guía reducido a lo que lo identifica: la serie y el número sin ceros.
 * "EG03 - 75", "EG03-00000075" y "eg03_75" son la misma guía.
 */
export function claveGuia(texto: string | null | undefined): string | null {
  const m = /([A-Za-z][A-Za-z0-9]{3})\s*[-_ ]\s*0*(\d{1,10})/.exec(texto ?? "");
  return m ? `${m[1].toUpperCase()}-${Number(m[2])}` : null;
}

/** Todos los números de guía (o de comprobante) que aparecen en el nombre de un archivo. */
function clavesEnNombre(nombre: string): Set<string> {
  const claves = new Set<string>();
  for (const m of nombre.matchAll(/([A-Za-z][A-Za-z0-9]{3})\s*[-_ ]\s*0*(\d{1,10})(?!\d)/g)) {
    claves.add(`${m[1].toUpperCase()}-${Number(m[2])}`);
  }
  return claves;
}

/**
 * Las guías que el comprobante dice tener: la de remisión (la que trae el XML, o la del
 * remitente escrita en el concepto) y la del transportista (la GRT del concepto).
 */
export type GuiasEsperadas = { remision: (string | null | undefined)[]; transportista: (string | null | undefined)[] };

/**
 * Lo que le falta al correo, en frases para mostrar tal cual. Vacío si trae todo.
 *
 * Una guía se reconoce primero por su número: si la factura dice "guía EG03-75" y viene un
 * archivo que se llama …EG03-75.pdf, esa es la guía, se llame como se llame lo demás. Solo
 * si no se puede cruzar por número se mira el tipo de SUNAT o las palabras del nombre.
 *
 * Una nota de crédito no lleva guías. Un archivo comprimido puede traer adentro el PDF y la
 * guía: como no se puede saber sin abrirlo, no se los da por faltantes.
 */
export function archivosFaltantes(
  archivos: ArchivoCorreo[],
  opciones: { xmlLegible: boolean; esNotaCredito?: boolean; guias?: GuiasEsperadas },
): string[] {
  if (archivos.length === 0) return [SIN_ADJUNTOS];
  const tipos = archivos.map(clasificarArchivo);
  const comprimido = tipos.includes("COMPRIMIDO");
  const faltan: string[] = [];
  if (!opciones.xmlLegible) faltan.push(tipos.includes("XML") || comprimido ? XML_ILEGIBLE : FALTA_XML);
  if (comprimido) return faltan;

  // Los documentos (no el XML) que coinciden con una guía que nombra la factura.
  const claves = (lista?: (string | null | undefined)[]) =>
    new Set((lista ?? []).map(claveGuia).filter((c): c is string => !!c));
  const esperadasRemision = claves(opciones.guias?.remision);
  const esperadasTransportista = claves(opciones.guias?.transportista);
  // Si el mismo número figura como las dos, es la del transportista (así lo dice el concepto).
  for (const k of esperadasTransportista) esperadasRemision.delete(k);
  const documentos = archivos
    .map((a, i) => ({ tipo: tipos[i], claves: clavesEnNombre(a.filename) }))
    .filter((d) => d.tipo !== "XML" && d.tipo !== "OTRO");
  const coincide = (d: { claves: Set<string> }, esperadas: Set<string>) => [...d.claves].some((k) => esperadas.has(k));
  const porNumeroRemision = documentos.filter((d) => coincide(d, esperadasRemision));
  const porNumeroTransportista = documentos.filter((d) => coincide(d, esperadasTransportista) && !porNumeroRemision.includes(d));
  const usados = new Set([...porNumeroRemision, ...porNumeroTransportista]);
  const libres = documentos.filter((d) => !usados.has(d));

  const tienePdf = libres.some((d) => d.tipo === "COMPROBANTE" || (opciones.esNotaCredito && d.tipo === "NOTA_CREDITO"));
  if (!tienePdf) faltan.push(FALTA_FACTURA);
  if (!opciones.esNotaCredito) {
    if (!porNumeroRemision.length && !libres.some((d) => d.tipo === "GUIA_REMITENTE")) faltan.push(FALTA_GUIA);
    if (!porNumeroTransportista.length && !libres.some((d) => d.tipo === "GUIA_TRANSPORTISTA")) faltan.push(FALTA_GUIA_TRANSPORTISTA);
  }
  return faltan;
}
