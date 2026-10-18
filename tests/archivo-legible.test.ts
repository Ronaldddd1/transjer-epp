/**
 * Que no se pueda subir un documento que después no se va a poder ver.
 *
 * El error que esto evita es el más caro del módulo: un archivo que se guarda sin
 * protestar y revienta meses más tarde, cuando hace falta mostrar el papel y ya no hay a
 * quién pedírselo. Una foto de 200 píxeles donde no se lee la fecha del SOAT, un PDF que
 * se cortó a mitad de la subida, un Word al que le cambiaron la extensión a .pdf.
 *
 * Lo que NO se prueba aquí, porque el sistema no lo juzga: si la foto está movida,
 * torcida o le falta un borde. Eso solo lo ve una persona.
 *
 *   npx tsx --conditions=react-server tests/archivo-legible.test.ts
 */
import { medidas, revisarArchivo, tipoReal } from "../src/server/archivo-legible";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("OK  ", n);
  else { fails++; console.log("FALLA", n, JSON.stringify(x ?? "")); }
};

/** Un PNG válido de las medidas que se pidan, con relleno para que pase el peso mínimo. */
function png(ancho: number, alto: number, bytes = 12 * 1024): Buffer {
  const cabecera = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(cabecera, 0);
  cabecera.writeUInt32BE(13, 8);
  cabecera.write("IHDR", 12, "ascii");
  cabecera.writeUInt32BE(ancho, 16);
  cabecera.writeUInt32BE(alto, 20);
  return Buffer.concat([cabecera, Buffer.alloc(Math.max(0, bytes - cabecera.length), 7)]);
}

/** Un JPEG con su marcador SOF0, que es de donde salen las medidas. */
function jpeg(ancho: number, alto: number, bytes = 12 * 1024): Buffer {
  // APP0: marcador, largo (incluye los dos bytes del largo) y relleno hasta ese largo.
  const app0 = Buffer.concat([
    Buffer.from([0xff, 0xe0, 0x00, 0x10]),
    Buffer.from("JFIF\0", "ascii"),
    Buffer.alloc(9),
  ]);
  // SOF0: largo, precisión, alto, ancho y un componente.
  const sof0 = Buffer.alloc(2 + 17);
  Buffer.from([0xff, 0xc0]).copy(sof0, 0);
  sof0.writeUInt16BE(17, 2);
  sof0.writeUInt8(8, 4);
  sof0.writeUInt16BE(alto, 5);
  sof0.writeUInt16BE(ancho, 7);

  const cabecera = Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof0]);
  return Buffer.concat([cabecera, Buffer.alloc(Math.max(0, bytes - cabecera.length), 7)]);
}

/** Un PDF mínimo pero completo: con páginas y con su %%EOF. */
function pdf({ completo = true, cifrado = false, paginas = true, bytes = 12 * 1024 } = {}): Buffer {
  const cuerpo = [
    "%PDF-1.4",
    paginas ? "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj" : "1 0 obj << /Type /Catalog >> endobj",
    paginas ? "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj" : "",
    cifrado ? "trailer << /Encrypt 9 0 R >>" : "trailer << /Root 1 0 R >>",
  ].join("\n");
  const relleno = "\n% " + "r".repeat(Math.max(0, bytes - cuerpo.length - 20)) + "\n";
  return Buffer.from(cuerpo + relleno + (completo ? "%%EOF" : "% cortado aqui"), "latin1");
}

function main() {
  // ---------- Lo que es de verdad el archivo ----------
  check("un PNG se reconoce por sus bytes", tipoReal(png(1000, 1400)) === "image/png");
  check("un JPEG se reconoce por sus bytes", tipoReal(jpeg(1000, 1400)) === "image/jpeg");
  check("un PDF se reconoce por sus bytes", tipoReal(pdf()) === "application/pdf");
  check("un Word no se reconoce como nada de lo que se acepta",
    tipoReal(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(9000)])) === null);

  // ---------- Las medidas, leídas de la cabecera ----------
  const m1 = medidas(png(1234, 567));
  check("de un PNG se leen ancho y alto", m1?.ancho === 1234 && m1?.alto === 567, m1);
  const m2 = medidas(jpeg(800, 2200));
  check("de un JPEG se leen ancho y alto", m2?.ancho === 800 && m2?.alto === 2200, m2);

  // ---------- Lo que se acepta ----------
  const ok1 = revisarArchivo(png(1240, 1754), "image/png", "soat.png");
  check("un escaneo A4 en PNG pasa", ok1.ok, ok1);
  const ok2 = revisarArchivo(jpeg(3024, 4032), "image/jpeg", "licencia.jpg");
  check("una foto de celular pasa", ok2.ok, ok2);
  const ok3 = revisarArchivo(pdf(), "application/pdf", "revision.pdf");
  check("un PDF completo pasa", ok3.ok, ok3);
  const ok4 = revisarArchivo(jpeg(900, 600), "image/jpeg", "justo.jpg");
  check("el lado más largo justo en 900 px pasa", ok4.ok, ok4);

  // ---------- Lo que se rechaza, y por qué ----------
  const vacio = revisarArchivo(Buffer.alloc(0), "application/pdf", "nada.pdf");
  check("un archivo vacío se rechaza", !vacio.ok);

  const chica = revisarArchivo(png(640, 480), "image/png", "foto.png");
  check("una foto de 640×480 se rechaza", !chica.ok);
  check("y el motivo dice las medidas y qué hacer",
    !chica.ok && chica.motivo.includes("640×480") && /tómala de nuevo|escanéala/i.test(chica.motivo),
    !chica.ok && chica.motivo);

  const minuscula = revisarArchivo(png(200, 300), "image/png", "miniatura.png");
  check("una miniatura de 200×300 se rechaza", !minuscula.ok);

  const liviano = revisarArchivo(png(1500, 2000, 900), "image/png", "blanco.png");
  check("un archivo de menos de 8 KB se rechaza por venir en blanco o cortado", !liviano.ok);
  check("y el motivo habla del peso, no de las medidas",
    !liviano.ok && /KB/.test(liviano.motivo), !liviano.ok && liviano.motivo);

  // Un Word renombrado a .pdf es el caso real: se sube sin problema y nadie lo abre
  // hasta que hace falta.
  const word = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20000, 3)]);
  const falso = revisarArchivo(word, "application/pdf", "soat.pdf");
  check("un Word renombrado a .pdf se rechaza", !falso.ok);
  check("y el motivo dice que por dentro es otra cosa",
    !falso.ok && /no es un PDF ni una foto/i.test(falso.motivo), !falso.ok && falso.motivo);

  // Una imagen que dice ser PDF: el tipo declarado no concuerda con el real.
  const mentiroso = revisarArchivo(png(1200, 1600), "application/pdf", "tarjeta.pdf");
  check("un PNG declarado como PDF se rechaza", !mentiroso.ok);
  check("y el motivo nombra los dos formatos",
    !mentiroso.ok && mentiroso.motivo.includes("image/png"), !mentiroso.ok && mentiroso.motivo);

  const cortado = revisarArchivo(pdf({ completo: false }), "application/pdf", "mtc.pdf");
  check("un PDF sin %%EOF se rechaza por estar incompleto", !cortado.ok);
  check("y el motivo invita a volver a subirlo",
    !cortado.ok && /incompleto/i.test(cortado.motivo), !cortado.ok && cortado.motivo);

  const conClave = revisarArchivo(pdf({ cifrado: true }), "application/pdf", "poliza.pdf");
  check("un PDF con contraseña se rechaza", !conClave.ok);
  check("y el motivo dice que se guarde sin contraseña",
    !conClave.ok && /contraseña/i.test(conClave.motivo), !conClave.ok && conClave.motivo);

  const sinPaginas = revisarArchivo(pdf({ paginas: false }), "application/pdf", "roto.pdf");
  check("un PDF sin páginas se rechaza", !sinPaginas.ok);

  // ---------- Que la extensión en mayúsculas o el .jpg no molesten ----------
  const jpgMayus = revisarArchivo(jpeg(1200, 1600), "image/jpeg", "DNI.JPG");
  check("un .JPG en mayúsculas pasa", jpgMayus.ok, jpgMayus);

  // ---------- HEIC: se acepta por peso ----------
  const heic = Buffer.concat([
    Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic", "ascii"), Buffer.alloc(20000, 1),
  ]);
  check("un HEIC del iPhone se reconoce", tipoReal(heic) === "image/heic");
  const okHeic = revisarArchivo(heic, "image/heic", "foto.heic");
  check("y pasa, porque sus medidas no están en un sitio fijo", okHeic.ok, okHeic);

  // ---------- Los motivos son para una persona ----------
  const motivos = [chica, liviano, falso, cortado, conClave]
    .filter((r): r is { ok: false; motivo: string } => !r.ok)
    .map((r) => r.motivo);
  check("ningún motivo dice 'validación', 'error' ni nombra un campo técnico",
    motivos.every((m) => !/validaci|invalid|error|null|undefined|buffer/i.test(m)), motivos);
  check("todos los motivos terminan en punto y empiezan en mayúscula o comilla",
    motivos.every((m) => /[.]$/.test(m.trim()) && /^["«A-ZÁÉÍÓÚÑ]/.test(m.trim())), motivos);

  console.log(fails === 0 ? `\nTodo bien (${fails} fallos)` : `\n${fails} FALLO(S)`);
  process.exit(fails === 0 ? 0 : 1);
}

main();
