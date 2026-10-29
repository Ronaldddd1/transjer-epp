import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { invoiceAttachments } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { readFile } from "@/server/storage";

export const dynamic = "force-dynamic";

/** Descarga o vista previa de un archivo adjunto de una factura. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Archivo inválido" }, { status: 400 });

  const [file] = await db.select().from(invoiceAttachments).where(eq(invoiceAttachments.id, id)).limit(1);
  if (!file) return NextResponse.json({ error: "El archivo no existe" }, { status: 404 });

  // El permiso depende de a qué cuelga el archivo. El voucher del pago de una cuota de
  // préstamo no es un papel de facturas: quien lleva las obligaciones tiene que poder
  // abrirlo, y quien solo ve facturas no.
  const permiso = file.installmentId ? "obligations.view" : "invoices.view";
  if (!can(user.role, permiso)) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });

  try {
    const data = await readFile(file);
    // Los PDF e imágenes se abren en el navegador; el resto se descarga.
    const inline = file.contentType.includes("pdf") || file.contentType.startsWith("image/");
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Length": String(data.byteLength),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("No se pudo leer el adjunto:", error);
    return NextResponse.json({ error: "No se pudo descargar el archivo" }, { status: 502 });
  }
}
