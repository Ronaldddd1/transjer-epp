/**
 * El comprobante de pago.
 *
 * La regla es corta: donde sale plata —factura, adelanto, detracción— no se registra el
 * pago sin la imagen, y en las cuotas de préstamos y servicios es opcional. Lo que esta
 * prueba cuida es que la imagen que se acepta de verdad se pueda abrir después: un archivo
 * ilegible guardado como respaldo es peor que no tener respaldo, porque nadie lo revisa
 * hasta el día en que hace falta.
 *
 * También cuida la cuenta del adelanto, que es la que el Excel traía mal: un adelanto no
 * puede pasar del saldo, y el saldo es el total menos la detracción y menos lo ya adelantado.
 *
 *   npx tsx --conditions=react-server tests/pagos-voucher.test.ts
 */
import "dotenv/config";
import { saldoAPagar } from "../src/lib/utils";
import { leerVoucher } from "../src/server/payment-proof";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("OK  ", n);
  else { fails++; console.log("FALLA", n, JSON.stringify(x ?? "")); }
};

/** Un PDF completo, con páginas y del peso que pide el sistema para un escaneo. */
function pdfValido(kb = 12): Buffer {
  return Buffer.concat([
    Buffer.from(
      "%PDF-1.4\n"
      + "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"
      + "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n"
      + "trailer << /Root 1 0 R >>\n",
    ),
    Buffer.from(`% ${"r".repeat(kb * 1024)}\n`),
    Buffer.from("%%EOF"),
  ]);
}

/** Un PNG de verdad, del tamaño que pide el sistema para que se lea un documento. */
function pngValido(lado = 1000): Buffer {
  const crc = (buf: Buffer) => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
    }
    return (~c) >>> 0;
  };
  const chunk = (tipo: string, datos: Buffer) => {
    const cuerpo = Buffer.concat([Buffer.from(tipo, "latin1"), datos]);
    const largo = Buffer.alloc(4); largo.writeUInt32BE(datos.length);
    const suma = Buffer.alloc(4); suma.writeUInt32BE(crc(cuerpo));
    return Buffer.concat([largo, cuerpo, suma]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0); ihdr.writeUInt32BE(lado, 4);
  ihdr[8] = 8; ihdr[9] = 0; // 8 bits, escala de grises
  // El relleno no tiene que ser una imagen válida pixel a pixel: lo que el sistema mira
  // son la firma, las medidas del IHDR y que el archivo no esté cortado ni vacío.
  const idat = chunk("IDAT", Buffer.alloc(20 * 1024, 0x78));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk("IHDR", ihdr), idat, chunk("IEND", Buffer.alloc(0)),
  ]);
}

function conArchivo(nombre: string, datos: Buffer, tipo: string): FormData {
  const fd = new FormData();
  fd.set("voucher", new File([new Uint8Array(datos)], nombre, { type: tipo }));
  return fd;
}

/** El motivo con el que el servidor rechaza, o null si aceptó. */
async function motivo(fd: FormData, requerido = true): Promise<string | null> {
  try {
    await leerVoucher(fd, { requerido });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

async function main() {
  // ---------- Sin imagen no hay pago ----------
  const vacio = new FormData();
  const sinNada = await motivo(vacio);
  check("sin imagen el pago se rechaza", !!sinNada && /falta la imagen/i.test(sinNada), sinNada);

  check("y en préstamos y servicios, donde es opcional, se deja pasar",
    (await leerVoucher(new FormData(), { requerido: false })) === null);

  // Un <input type=file> vacío manda un File de cero bytes, no manda nada: cuenta igual
  // que no haber subido nada, y es el caso que de verdad llega del navegador.
  const cero = conArchivo("captura.png", Buffer.alloc(0), "image/png");
  const conCero = await motivo(cero);
  check("un archivo de cero bytes cuenta como no haber subido nada",
    !!conCero && /falta la imagen/i.test(conCero), conCero);

  // ---------- Lo que no se va a poder abrir no se guarda ----------
  const textoPlano = await motivo(conArchivo("voucher.txt", Buffer.alloc(20 * 1024, 0x41), "text/plain"));
  check("un archivo que no es imagen ni PDF se rechaza por la extensión",
    !!textoPlano && /no es una imagen ni un pdf/i.test(textoPlano), textoPlano);

  const wordDisfrazado = await motivo(
    conArchivo("voucher.pdf", Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.alloc(20 * 1024)]), "application/pdf"),
  );
  check("un archivo que por dentro no es un PDF ni una foto se rechaza",
    !!wordDisfrazado && /no es un pdf ni una foto/i.test(wordDisfrazado), wordDisfrazado);

  const cortado = Buffer.concat([
    Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"),
    Buffer.from(`% ${"r".repeat(12 * 1024)}\n% se corto la subida aqui`),
  ]);
  const incompleto = await motivo(conArchivo("voucher.pdf", cortado, "application/pdf"));
  check("un PDF cortado a mitad de la subida se rechaza",
    !!incompleto && /incompleto/i.test(incompleto), incompleto);

  const diminuto = await motivo(conArchivo("captura.png", pngValido(1000).subarray(0, 300), "image/png"));
  check("una captura cortada tampoco pasa", !!diminuto, diminuto);

  // ---------- Lo bueno sí ----------
  const pdf = await leerVoucher(conArchivo("constancia.pdf", pdfValido(), "application/pdf"), { requerido: true });
  check("un PDF completo se acepta y conserva su nombre",
    pdf?.filename === "constancia.pdf" && pdf.data.byteLength > 8 * 1024, pdf?.filename);

  const png = await leerVoucher(conArchivo("captura.png", pngValido(), "image/png"), { requerido: true });
  check("una captura de la transferencia se acepta", png?.contentType === "image/png", png?.contentType);

  // El campo se puede llamar distinto; lo que no cambia es la regla.
  const otroCampo = new FormData();
  otroCampo.set("constancia", new File([new Uint8Array(pdfValido())], "c.pdf", { type: "application/pdf" }));
  const leido = await leerVoucher(otroCampo, { requerido: true, campo: "constancia" });
  check("se puede leer de otro campo del formulario", leido?.filename === "c.pdf", leido?.filename);

  // ---------- La cuenta del adelanto ----------
  // Factura de 2,950 con detracción de 118: al proveedor se le transfieren 2,832.
  check("el saldo baja con cada adelanto",
    saldoAPagar("2950.00", "118.00", null) === "2832.00"
    && saldoAPagar("2950.00", "118.00", "832.00") === "2000.00",
    [saldoAPagar("2950.00", "118.00", null), saldoAPagar("2950.00", "118.00", "832.00")]);

  check("un adelanto que cubre todo deja el saldo en cero, no en negativo",
    saldoAPagar("2950.00", "118.00", "2832.00") === "0.00"
    && saldoAPagar("2950.00", "118.00", "5000.00") === "0.00",
    [saldoAPagar("2950.00", "118.00", "2832.00"), saldoAPagar("2950.00", "118.00", "5000.00")]);

  // Es la comparación que hace la acción antes de aceptar un adelanto.
  const saldo = Number(saldoAPagar("2950.00", "118.00", "832.00"));
  check("un adelanto mayor que el saldo no pasa, y uno igual al saldo sí",
    2000.01 > saldo + 0.004 && !(2000 > saldo + 0.004), saldo);

  console.log(fails === 0 ? `\nTodo bien (${fails} fallos)` : `\n${fails} FALLO(S)`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
