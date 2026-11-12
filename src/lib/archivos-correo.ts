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
 * Lo que le falta al correo, en frases para mostrar tal cual. Vacío si trae todo.
 *
 * Una nota de crédito no lleva guías. Un archivo comprimido puede traer adentro el PDF y la
 * guía: como no se puede saber sin abrirlo, no se los da por faltantes.
 */
export function archivosFaltantes(
  archivos: ArchivoCorreo[],
  opciones: { xmlLegible: boolean; esNotaCredito?: boolean },
): string[] {
  if (archivos.length === 0) return [SIN_ADJUNTOS];
  const tipos = archivos.map(clasificarArchivo);
  const comprimido = tipos.includes("COMPRIMIDO");
  const faltan: string[] = [];
  if (!opciones.xmlLegible) faltan.push(tipos.includes("XML") || comprimido ? XML_ILEGIBLE : FALTA_XML);
  if (!comprimido) {
    const tienePdf = tipos.includes("COMPROBANTE") || (opciones.esNotaCredito && tipos.includes("NOTA_CREDITO"));
    if (!tienePdf) faltan.push(FALTA_FACTURA);
    if (!opciones.esNotaCredito) {
      if (!tipos.includes("GUIA_REMITENTE")) faltan.push(FALTA_GUIA);
      if (!tipos.includes("GUIA_TRANSPORTISTA")) faltan.push(FALTA_GUIA_TRANSPORTISTA);
    }
  }
  return faltan;
}
