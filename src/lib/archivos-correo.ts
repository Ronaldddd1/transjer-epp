/**
 * Qué archivos trae un correo de comprobante y cuáles faltan.
 *
 * Un comprobante completo llega con tres cosas: la factura (el PDF), su XML y la guía de
 * remisión. El sistema solo puede saber qué es cada archivo por su nombre, así que se usa
 * lo que SUNAT pone en los nombres (RUC-TIPO-SERIE-NÚMERO, donde 01 es factura, 07 nota
 * de crédito, 09 guía del remitente y 31 guía del transportista) y las palabras con las
 * que se suelen nombrar a mano ("guia", "remision", "factura").
 */

export type ArchivoCorreo = { filename: string; contentType?: string | null };
export type TipoArchivo = "XML" | "GUIA" | "NOTA_CREDITO" | "COMPROBANTE" | "COMPRIMIDO" | "OTRO";

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
  if (tipoSunat === "09" || tipoSunat === "31" || /guia|remision|\bgr[rt]?\b/.test(n)) return "GUIA";
  if (tipoSunat === "07" || /nota.?(de.?)?credito|\bnc\b/.test(n)) return "NOTA_CREDITO";
  return "COMPROBANTE";
}

export const FALTA_XML = "No se encontró el XML del comprobante entre los archivos.";
export const XML_ILEGIBLE = "El XML adjunto no se pudo leer.";
export const FALTA_FACTURA = "No se encontró la factura (PDF) entre los archivos.";
export const FALTA_GUIA = "No se encontró la guía de remisión entre los archivos.";
export const SIN_ADJUNTOS = "El correo no trae archivos adjuntos.";

/**
 * Lo que le falta al correo, en frases para mostrar tal cual. Vacío si trae todo.
 *
 * Una nota de crédito no lleva guía. Un archivo comprimido puede traer adentro el PDF y la
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
    if (!opciones.esNotaCredito && !tipos.includes("GUIA")) faltan.push(FALTA_GUIA);
  }
  return faltan;
}
