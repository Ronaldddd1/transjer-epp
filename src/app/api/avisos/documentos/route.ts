import { NextResponse, type NextRequest } from "next/server";
import {
  avisosDeDocumentos, DIAS_DE_AVISO_DOCUMENTOS, marcarDocumentosAvisados, mensajeDeDocumentos,
} from "@/server/document-reminders";

export const dynamic = "force-dynamic";

/**
 * Lo que el servidor de avisos necesita para avisar de los documentos de flota por vencer.
 *
 * Igual que /api/avisos/vencimientos: el VPS pregunta (GET), envía y vuelve a decir qué
 * salió (POST). Se identifica con la misma AVISOS_SECRET.
 *
 *   GET  /api/avisos/documentos?dias=7
 *   POST /api/avisos/documentos   { "enviados": ["id", "id"] }
 *
 * Es una ruta aparte, y no parte de la de cuotas, para que el script que ya corre en el
 * droplet siga funcionando igual hasta que se copie el nuevo: si los documentos entraran
 * en el mismo mensaje, el script viejo no sabría marcarlos y llegarían todos los días.
 */

function autorizado(req: NextRequest): boolean {
  const secret = process.env.AVISOS_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const crudo = req.nextUrl.searchParams.get("dias");
  const pedido = crudo === null || crudo === "" ? NaN : Number(crudo);
  const dias = Number.isFinite(pedido) && pedido >= 0 ? pedido : DIAS_DE_AVISO_DOCUMENTOS;

  const documentos = await avisosDeDocumentos(dias);
  return NextResponse.json({
    ok: true,
    dias,
    documentos,
    // Null cuando no hay nada que avisar: el VPS no manda ningún mensaje ese día.
    mensaje: mensajeDeDocumentos(documentos, req.nextUrl.origin),
  });
}

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  let cuerpo: unknown;
  try {
    cuerpo = await req.json();
  } catch {
    return NextResponse.json({ error: "El cuerpo debe ser JSON." }, { status: 400 });
  }

  const enviados = (cuerpo as { enviados?: unknown })?.enviados;
  if (!Array.isArray(enviados) || enviados.some((v) => typeof v !== "string")) {
    return NextResponse.json({ error: "Se espera { enviados: [\"id\", …] }." }, { status: 400 });
  }

  const marcados = await marcarDocumentosAvisados(enviados as string[]);
  return NextResponse.json({ ok: true, marcados });
}
