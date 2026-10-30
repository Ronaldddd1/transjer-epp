import "server-only";
import { BusinessError } from "@/lib/action-result";
import { revisarArchivo } from "@/server/archivo-legible";
import { maxBytesFor } from "@/server/storage";
import type { Tx } from "@/db";
import { saveAttachment, type ReadFile } from "@/server/invoice-service";

/**
 * El comprobante de un pago: la captura de la transferencia, la constancia del banco.
 *
 * Se guarda siempre que lo suban, pero no frena el registro. Exigirlo salía caro: la
 * captura suele llegar después —por WhatsApp, o al día siguiente— y el pago se quedaba sin
 * registrar mientras tanto, de modo que la factura seguía figurando como pendiente cuando
 * ya estaba pagada. Eso es peor problema que una factura sin imagen, y la imagen se puede
 * adjuntar luego desde los archivos de la factura.
 *
 * Lo que sí se mantiene es la revisión: si suben algo, tiene que poder abrirse. Se mide con
 * la misma vara que los documentos de los vehículos, y las fotos llegan ya achicadas desde
 * el navegador, así que una captura de celular entra sin toparse con el tope.
 */

/** Lo que puede ser un voucher: la foto o el PDF que da el banco. */
const EXTENSIONES = /\.(pdf|png|jpg|jpeg|webp|heic|heif)$/i;

/**
 * Lee el voucher del formulario y lo revisa, sin guardarlo todavía.
 *
 * Se revisa antes de abrir la transacción del pago: si el archivo no sirve, el pago no
 * tiene que haber empezado a registrarse.
 */
export async function leerVoucher(
  formData: FormData,
  opciones: { requerido: boolean; campo?: string; falta?: string },
): Promise<ReadFile | null> {
  const entry = formData.get(opciones.campo ?? "voucher");
  const tiene = entry instanceof File && entry.size > 0;

  if (!tiene) {
    if (!opciones.requerido) return null;
    throw new BusinessError(
      opciones.falta ?? "Falta la imagen del pago: sin el voucher el pago no se registra.",
    );
  }

  const file = entry as File;
  if (!EXTENSIONES.test(file.name)) {
    throw new BusinessError(`"${file.name}" no es una imagen ni un PDF. Sube la captura de la transferencia.`);
  }
  const limite = maxBytesFor();
  if (file.size > limite) {
    throw new BusinessError(
      `"${file.name}" pesa demasiado. El máximo es ${Math.floor(limite / 1024 / 1024)} MB.`,
    );
  }

  const data = Buffer.from(await file.arrayBuffer());
  const contentType = file.type || "application/octet-stream";
  const revision = revisarArchivo(data, contentType, file.name);
  if (!revision.ok) throw new BusinessError(revision.motivo);

  return { filename: file.name, contentType, data };
}

/** Guarda el voucher ya leído y devuelve el id del adjunto, para dejarlo en el pago. */
export async function guardarVoucher(
  tx: Tx,
  voucher: ReadFile,
  dueño: { invoiceId?: string | null; installmentId?: string | null; uploadedBy: string },
): Promise<string> {
  const row = await saveAttachment(tx, {
    invoiceId: dueño.invoiceId ?? null,
    installmentId: dueño.installmentId ?? null,
    kind: "VOUCHER",
    filename: voucher.filename,
    contentType: voucher.contentType,
    data: voucher.data,
    uploadedBy: dueño.uploadedBy,
  });
  return row.id;
}
