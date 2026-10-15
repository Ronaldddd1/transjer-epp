import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getDocumentFile } from "@/server/document-queries";
import { readFile } from "@/server/storage";

export const dynamic = "force-dynamic";

/** Abre o descarga el archivo de un documento de trabajador o de vehículo. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(user.role, "documents.view")) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Documento inválido" }, { status: 400 });

  const file = await getDocumentFile(id);
  if (!file) return NextResponse.json({ error: "El documento no existe" }, { status: 404 });

  try {
    const data = await readFile(file);
    // Los PDF y las fotos se abren en el navegador, que es lo que se quiere al revisar un
    // SOAT; cualquier otra cosa se descarga.
    const enPantalla = file.contentType.includes("pdf") || file.contentType.startsWith("image/");
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Length": String(data.byteLength),
        "Content-Disposition": `${enPantalla ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("No se pudo leer el documento:", error);
    return NextResponse.json({ error: "No se pudo descargar el archivo" }, { status: 502 });
  }
}
