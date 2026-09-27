import { NextResponse, type NextRequest } from "next/server";
import {
  createSubscription, getSubscription, readMailboxConfig, renewSubscription, notificationUrl,
} from "@/server/graph";
import { syncMailbox } from "@/server/invoice-ingest";
import { getSubscriptionState, minutesToExpiry, setSubscriptionState } from "@/server/mailbox-state";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Tarea diaria: renueva el aviso automático antes de que caduque y repasa el buzón por si
 * algún aviso se perdió. Con esto basta el plan gratuito de Vercel, que solo permite una
 * ejecución al día.
 *
 * Vercel la llama con la cabecera Authorization: Bearer $CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const config = readMailboxConfig();
  if (!config) return NextResponse.json({ ok: true, detalle: "El buzón no está configurado." });

  const salida: Record<string, unknown> = {};

  // 1. Mantener viva la suscripción de avisos.
  try {
    const state = await getSubscriptionState();
    const restante = minutesToExpiry(state);
    if (!state) {
      const created = await createSubscription(config);
      await setSubscriptionState({
        id: created.id,
        expirationDateTime: created.expirationDateTime,
        notificationUrl: created.notificationUrl ?? notificationUrl() ?? "",
        createdAt: new Date().toISOString(),
      });
      salida.suscripcion = "creada";
    } else if (restante !== null && restante < 60 * 48) {
      const live = await getSubscription(config, state.id);
      const renewed = live ? await renewSubscription(config, state.id) : await createSubscription(config);
      await setSubscriptionState({
        id: renewed.id,
        expirationDateTime: renewed.expirationDateTime,
        notificationUrl: renewed.notificationUrl ?? state.notificationUrl,
        createdAt: live ? state.createdAt : new Date().toISOString(),
      });
      salida.suscripcion = live ? "renovada" : "recreada";
    } else {
      salida.suscripcion = "vigente";
    }
  } catch (error) {
    salida.suscripcion = `error: ${error instanceof Error ? error.message : "desconocido"}`;
  }

  // 2. Repasar el buzón por si se perdió algún aviso.
  try {
    salida.revision = await syncMailbox(config);
  } catch (error) {
    salida.revision = `error: ${error instanceof Error ? error.message : "desconocido"}`;
  }

  return NextResponse.json({ ok: true, ...salida });
}
