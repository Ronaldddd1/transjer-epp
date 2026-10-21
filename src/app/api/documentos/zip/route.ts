import { zipSync, strToU8 } from "fflate";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { DOCUMENT_KIND_LABEL, formatDate, todayLima } from "@/lib/utils";
import { documentosParaDescargar, getVehicle } from "@/server/document-queries";
import { readFile } from "@/server/storage";

export const dynamic = "force-dynamic";

/**
 * Baja de una vez todos los documentos de la flota, o los de una unidad.
 *
 * Es lo que se pide cuando llega una fiscalización o un cliente nuevo pide los papeles de
 * las unidades que van a trabajar para él: hasta ahora había que abrir unidad por unidad y
 * guardar PDF por PDF.
 *
 * El ZIP va con una carpeta por placa y los archivos renombrados a lo que son —"SOAT
 * 2027-06-30.pdf"—, porque los nombres originales salen del escáner y no dicen nada.
 * Dentro va también un índice en texto con lo que lleva y lo que falta.
 */

/** Un nombre que Windows acepte: sin barras, dos puntos ni acentos sueltos. */
function nombreSeguro(texto: string): string {
  return texto
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!can(user.role, "documents.view")) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });

  const vehiculo = new URL(req.url).searchParams.get("vehiculo") ?? undefined;
  if (vehiculo && !/^[0-9a-f-]{36}$/i.test(vehiculo)) {
    return NextResponse.json({ error: "Vehículo inválido" }, { status: 400 });
  }

  const unidad = vehiculo ? await getVehicle(vehiculo) : null;
  if (vehiculo && !unidad) return NextResponse.json({ error: "Ese vehículo no existe" }, { status: 404 });

  const filas = await documentosParaDescargar(vehiculo);
  if (filas.length === 0) {
    return NextResponse.json(
      { error: "No hay ningún documento con archivo cargado para descargar." },
      { status: 404 },
    );
  }

  const archivos: Record<string, Uint8Array> = {};
  const indice: string[] = [
    unidad ? `Documentos de la unidad ${unidad.plate}` : "Documentos de la flota",
    `Generado el ${formatDate(todayLima())} por ${user.name}`,
    "",
  ];
  const fallidos: string[] = [];
  let bytes = 0;

  for (const d of filas) {
    const carpeta = nombreSeguro(d.plate ?? d.employeeName ?? "Sin unidad");
    const etiqueta = DOCUMENT_KIND_LABEL[d.kind] ?? d.kind;
    const vence = d.expiresAt ? ` ${d.expiresAt}` : "";
    const extension = (d.filename ?? "").match(/\.[A-Za-z0-9]{1,5}$/)?.[0] ?? "";
    const nombre = `${nombreSeguro(etiqueta + vence)}${extension}`;

    try {
      const data = await readFile({
        storageDriver: d.storageDriver!,
        storageKey: d.storageKey,
        content: d.content,
      });
      // Dos documentos del mismo tipo y fecha en la misma unidad no se pisan.
      let ruta = `${carpeta}/${nombre}`;
      let n = 2;
      while (archivos[ruta]) ruta = `${carpeta}/${nombreSeguro(etiqueta + vence)} (${n++})${extension}`;

      archivos[ruta] = new Uint8Array(data);
      bytes += data.byteLength;
      indice.push(`${carpeta} · ${etiqueta}${d.expiresAt ? ` · vence el ${formatDate(d.expiresAt)}` : " · sin vencimiento"}`);
    } catch {
      // Un archivo ilegible no puede tumbar la descarga entera: se anota y se sigue.
      fallidos.push(`${carpeta} · ${etiqueta}`);
    }
  }

  if (Object.keys(archivos).length === 0) {
    return NextResponse.json({ error: "No se pudo leer ninguno de los archivos." }, { status: 502 });
  }

  if (fallidos.length > 0) {
    indice.push("", `No se pudieron incluir ${fallidos.length} archivo(s):`, ...fallidos.map((f) => `  ${f}`));
  }
  archivos["_LEEME.txt"] = strToU8(indice.join("\r\n"));

  // Nivel 0: los PDF ya vienen comprimidos y volver a comprimirlos gasta tiempo de
  // servidor para ahorrar casi nada.
  const zip = zipSync(archivos, { level: 0 });
  const nombreZip = unidad
    ? `documentos-${nombreSeguro(unidad.plate)}-${todayLima()}.zip`
    : `documentos-flota-${todayLima()}.zip`;

  return new NextResponse(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(zip.byteLength),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(nombreZip)}`,
      "Cache-Control": "private, no-store",
      // Para poder avisar en la pantalla de cuántos archivos salieron y cuántos no.
      "X-Archivos": String(Object.keys(archivos).length - 1),
      "X-Bytes": String(bytes),
    },
  });
}
