import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";

/** Estado de la conexión con el buzón, guardado en la base (nunca credenciales). */

export type SubscriptionState = {
  id: string;
  expirationDateTime: string;
  notificationUrl: string;
  createdAt: string;
};

export type SyncState = {
  /** Última vez que se revisó el buzón. */
  at: string;
  /** Fecha del mensaje más reciente ya procesado. */
  lastMessageAt: string | null;
  lastError?: string | null;
};

const SUBSCRIPTION_KEY = "mailbox.subscription";
const SYNC_KEY = "mailbox.sync";

async function readSetting<T>(key: string): Promise<T | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return (row?.value as T) ?? null;
}

async function writeSetting(key: string, value: unknown) {
  await db.insert(appSettings).values({ key, value: value as object })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: value as object, updatedAt: new Date() } });
}

export const getSubscriptionState = () => readSetting<SubscriptionState>(SUBSCRIPTION_KEY);
export const setSubscriptionState = (state: SubscriptionState) => writeSetting(SUBSCRIPTION_KEY, state);
export async function clearSubscriptionState() {
  await db.delete(appSettings).where(eq(appSettings.key, SUBSCRIPTION_KEY));
}

export const getSyncState = () => readSetting<SyncState>(SYNC_KEY);
export const setSyncState = (state: SyncState) => writeSetting(SYNC_KEY, state);

/** Minutos que faltan para que caduque el aviso automático. */
export function minutesToExpiry(state: SubscriptionState | null): number | null {
  if (!state) return null;
  return Math.round((Date.parse(state.expirationDateTime) - Date.now()) / 60_000);
}
