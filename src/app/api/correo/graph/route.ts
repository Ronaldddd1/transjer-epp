import { after, NextResponse, type NextRequest } from "next/server";
import { readMailboxConfig } from "@/server/mailbox-config";
import { ingestMessage } from "@/server/invoice-ingest";
import { getSubscriptionState } from "@/server/mailbox-state";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Aviso instantáneo de Microsoft 365: se llama sola cada vez que llega un correo al buzón
 * de facturas. Microsoft espera una respuesta en menos de 10 segundos, así que se contesta
 * de inmediato y el correo se procesa justo después.
 */

/** Al crear la suscripción, Microsoft comprueba la dirección con un código que hay que devolver. */
function validationResponse(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("validationToken");
  if (!token) return null;
  return new NextResponse(token, { status: 200, headers: { "Content-Type": "text/plain" } });
}

export async function POST(req: NextRequest) {
  const validation = validationResponse(req);
  if (validation) return validation;

  const config = readMailboxConfig();
  // Este aviso solo lo manda Microsoft. Con un buzón IMAP la ruta no tiene sentido.
  if (config && config.kind !== "graph") return NextResponse.json({ error: "No aplica" }, { status: 404 });
  if (!config) return NextResponse.json({ error: "El buzón no está configurado" }, { status: 503 });

  let body: { value?: { subscriptionId?: string; clientState?: string; resourceData?: { id?: string } }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Aviso inválido" }, { status: 400 });
  }

  const notifications = body.value ?? [];
  const state = await getSubscriptionState();

  const messageIds: string[] = [];
  for (const n of notifications) {
    // La palabra secreta confirma que el aviso viene de nuestra suscripción y no de un tercero.
    if (n.clientState !== config.webhookSecret) {
      console.warn("Aviso de correo descartado: la palabra secreta no coincide.");
      continue;
    }
    if (state && n.subscriptionId && n.subscriptionId !== state.id) {
      console.warn("Aviso de correo descartado: corresponde a otra suscripción.");
      continue;
    }
    const id = n.resourceData?.id;
    if (id) messageIds.push(id);
  }

  // Se responde ya y el correo se procesa a continuación, para no agotar el tiempo de Microsoft.
  after(async () => {
    for (const id of messageIds) {
      try {
        const outcome = await ingestMessage(config, id);
        if (outcome.result === "error") console.error("Correo con error:", outcome.reason);
      } catch (error) {
        console.error("No se pudo procesar el correo avisado:", error);
      }
    }
  });

  return new NextResponse(null, { status: 202 });
}

/** Microsoft valida la dirección también con GET en algunas comprobaciones. */
export async function GET(req: NextRequest) {
  return validationResponse(req) ?? NextResponse.json({ ok: true });
}
