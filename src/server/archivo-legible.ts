import "server-only";

/**
 * Revisa que un archivo subido se pueda abrir y leer, antes de guardarlo.
 *
 * Lo que arruina un archivo de documentos no es que pese mucho: es que no se vea. Una
 * foto de 300 píxeles donde no se lee la fecha del SOAT, un PDF que se cortó a mitad de
 * la subida, un archivo con contraseña, o un Word al que alguien le cambió la extensión
 * a .pdf. Todos esos se guardan igual de bien y se descubren meses después, cuando hace
 * falta mostrar el documento.
 *
 * Esto NO juzga si la foto está movida, torcida o le falta un borde: eso solo lo ve una
 * persona. Lo que hace es rechazar lo que con seguridad no se va a poder leer.
 */

export type Revision = { ok: true; detalle?: string } | { ok: false; motivo: string };

/** Menos que esto no es un escaneo de un documento: es un archivo vacío o cortado. */
const MINIMO_BYTES = 8 * 1024;

/**
 * El lado más largo que debe tener una foto para que se lea un documento.
 *
 * Un A4 escaneado a 150 ppp da unos 1.750 px de alto; una foto de celular, mucho más.
 * Por debajo de 900 px el texto chico —fechas, números de placa— ya no se distingue.
 */
const MINIMO_PIXELES = 900;

const FIRMAS: { tipo: string; firma: number[]; desplazamiento?: number }[] = [
  { tipo: "application/pdf", firma: [0x25, 0x50, 0x44, 0x46] },              // %PDF
  { tipo: "image/jpeg", firma: [0xff, 0xd8, 0xff] },
  { tipo: "image/png", firma: [0x89, 0x50, 0x4e, 0x47] },
  { tipo: "image/webp", firma: [0x57, 0x45, 0x42, 0x50], desplazamiento: 8 }, // RIFF....WEBP
  { tipo: "image/heic", firma: [0x66, 0x74, 0x79, 0x70], desplazamiento: 4 }, // ....ftyp
];

function empiezaCon(data: Buffer, firma: number[], desplazamiento = 0): boolean {
  if (data.length < desplazamiento + firma.length) return false;
  return firma.every((b, i) => data[desplazamiento + i] === b);
}

/** Qué es el archivo de verdad, mirando sus primeros bytes y no su extensión. */
export function tipoReal(data: Buffer): string | null {
  for (const f of FIRMAS) {
    if (empiezaCon(data, f.firma, f.desplazamiento)) return f.tipo;
  }
  return null;
}

/** Alto y ancho de una imagen, leídos de su cabecera. */
export function medidas(data: Buffer): { ancho: number; alto: number } | null {
  // PNG: el bloque IHDR va siempre en la misma posición.
  if (empiezaCon(data, [0x89, 0x50, 0x4e, 0x47]) && data.length > 24) {
    return { ancho: data.readUInt32BE(16), alto: data.readUInt32BE(20) };
  }

  // JPEG: hay que recorrer los marcadores hasta el de inicio de cuadro (SOF).
  if (empiezaCon(data, [0xff, 0xd8, 0xff])) {
    let i = 2;
    while (i + 9 < data.length) {
      if (data[i] !== 0xff) { i++; continue; }
      const marcador = data[i + 1];
      // SOF0..SOF15, saltando los que no describen el cuadro (DHT, DAA, DRI).
      const esSOF = marcador >= 0xc0 && marcador <= 0xcf
        && marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc;
      const largo = data.readUInt16BE(i + 2);
      if (esSOF) return { alto: data.readUInt16BE(i + 5), ancho: data.readUInt16BE(i + 7) };
      i += 2 + largo;
    }
    return null;
  }

  // WebP, el formato simple.
  if (empiezaCon(data, [0x57, 0x45, 0x42, 0x50], 8) && data.length > 30) {
    const formato = data.toString("ascii", 12, 16);
    if (formato === "VP8 ") {
      return { ancho: data.readUInt16LE(26) & 0x3fff, alto: data.readUInt16LE(28) & 0x3fff };
    }
    if (formato === "VP8L") {
      const bits = data.readUInt32LE(21);
      return { ancho: (bits & 0x3fff) + 1, alto: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (formato === "VP8X") {
      const ancho = 1 + (data[24] | (data[25] << 8) | (data[26] << 16));
      const alto = 1 + (data[27] | (data[28] << 8) | (data[29] << 16));
      return { ancho, alto };
    }
  }

  return null;
}

/**
 * Lo que se puede saber de un PDF sin abrirlo con un lector entero: si está completo,
 * si tiene páginas y si pide contraseña.
 */
function revisarPdf(data: Buffer): Revision {
  // Un PDF termina en %%EOF. Si no está, la subida se cortó a medio camino y el
  // visor va a mostrar un archivo dañado.
  const cola = data.subarray(Math.max(0, data.length - 2048)).toString("latin1");
  if (!cola.includes("%%EOF")) {
    return { ok: false, motivo: "El PDF está incompleto: parece que la subida se cortó. Vuelve a intentarlo." };
  }

  const texto = data.toString("latin1");
  if (/\/Encrypt\b/.test(texto)) {
    return { ok: false, motivo: "El PDF está protegido con contraseña y no se podría abrir desde el sistema. Guárdalo sin contraseña." };
  }
  if (!/\/Type\s*\/Page[^s]/.test(texto) && !/\/Pages\b/.test(texto)) {
    return { ok: false, motivo: "El PDF no tiene páginas legibles. Vuelve a generarlo o escanéalo de nuevo." };
  }
  return { ok: true };
}

/**
 * La revisión completa. Devuelve el motivo en palabras, listo para mostrar: quien sube
 * el archivo tiene que entender qué hacer, no que "falló la validación".
 */
export function revisarArchivo(
  data: Buffer,
  contentType: string,
  filename: string,
): Revision {
  if (data.byteLength === 0) {
    return { ok: false, motivo: "El archivo está vacío." };
  }

  const real = tipoReal(data);
  if (!real) {
    return {
      ok: false,
      motivo: `"${filename}" no es un PDF ni una foto: por dentro es otra cosa. Guárdalo como PDF o JPG y vuelve a subirlo.`,
    };
  }

  // La extensión miente con facilidad; los primeros bytes no. Un .pdf que por dentro es
  // un Word se guarda igual de bien y revienta recién cuando alguien intenta verlo.
  const declarado = contentType.toLowerCase();
  const compatible = declarado.includes(real.split("/")[1])
    || (real === "image/jpeg" && declarado.includes("jpg"))
    || declarado === real;
  if (!compatible) {
    return {
      ok: false,
      motivo: `"${filename}" dice ser ${declarado} pero por dentro es ${real}. Vuelve a guardarlo en el formato correcto.`,
    };
  }

  if (data.byteLength < MINIMO_BYTES) {
    return {
      ok: false,
      motivo: `"${filename}" pesa ${(data.byteLength / 1024).toFixed(0)} KB: es muy poco para un documento escaneado y seguramente salió en blanco o cortado.`,
    };
  }

  if (real === "application/pdf") return revisarPdf(data);

  // HEIC no trae las medidas en un sitio fijo; se acepta por tamaño, que es lo que se
  // puede comprobar sin abrir la imagen entera.
  if (real === "image/heic") return { ok: true };

  const m = medidas(data);
  if (!m) {
    return { ok: false, motivo: `No se pudo leer "${filename}": la imagen está dañada.` };
  }
  const lado = Math.max(m.ancho, m.alto);
  if (lado < MINIMO_PIXELES) {
    return {
      ok: false,
      motivo: `La foto es muy chica (${m.ancho}×${m.alto} px) y no se va a poder leer. `
        + `Tómala de nuevo más cerca o escanéala: el lado más largo debe tener al menos ${MINIMO_PIXELES} píxeles.`,
    };
  }

  return { ok: true, detalle: `${m.ancho}×${m.alto} px` };
}
