import { NextResponse, type NextRequest } from "next/server";
import { avisosPendientes, DIAS_DE_AVISO, marcarAvisadas, mensajeDeAvisos } from "@/server/reminders";

export const dynamic = "force-dynamic";

/**
 * Lo que el servidor de avisos necesita para mandar los WhatsApp.
 *
 * El VPS pregunta (GET), envía por su cuenta y vuelve a decir qué salió (POST). Así el
 * servidor de avisos no necesita puertos abiertos ni Transjer Gestión necesita saber nada
 * de WhatsApp. Se identifica con AVISOS_SECRET, igual que la tarea programada con CRON_SECRET.
 *
 *   GET  /api/avisos/vencimientos?dias=2
 *   POST /api/avisos/vencimientos   { "enviados": ["id", "id"] }
 */

function autorizado(req: NextRequest): boolean {
  const secret = process.env.AVISOS_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const pedido = Number(req.nextUrl.searchParams.get("dias"));
  const dias = Number.isFinite(pedido) && pedido >= 0 ? pedido : DIAS_DE_AVISO;

  const cuotas = await avisosPendientes(dias);
  return NextResponse.json({
    ok: true,
    dias,
    cuotas,
    // Null cuando no hay nada que avisar: el VPS no manda ningún mensaje ese día.
    mensaje: mensajeDeAvisos(cuotas),
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

  const marcadas = await marcarAvisadas(enviados as string[]);
  return NextResponse.json({ ok: true, marcadas });
}
