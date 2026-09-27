import "server-only";
import { BusinessError } from "@/lib/action-result";

/**
 * Almacenamiento de los archivos adjuntos de las facturas (PDF, XML, guías).
 *
 * El modo se detecta solo, según las variables de entorno configuradas:
 *   - "blob"     → Vercel Blob            (BLOB_READ_WRITE_TOKEN)
 *   - "supabase" → Supabase Storage       (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
 *   - "db"       → la propia base de datos (sin configurar nada)
 *
 * El modo "db" sirve para empezar sin configurar servicios, pero los archivos ocupan
 * espacio de la base. Para uso continuo conviene "blob" o "supabase".
 */
export type StorageDriver = "db" | "blob" | "supabase";

export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
/** En modo "db" los archivos viven dentro de la base: se limita más para no llenarla. */
export const MAX_DB_ATTACHMENT_BYTES = 3 * 1024 * 1024;

const SUPABASE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "facturas";

export function activeDriver(): StorageDriver {
  if (process.env.BLOB_READ_WRITE_TOKEN) return "blob";
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) return "supabase";
  return "db";
}

export function maxBytesFor(driver: StorageDriver = activeDriver()) {
  return driver === "db" ? MAX_DB_ATTACHMENT_BYTES : MAX_ATTACHMENT_BYTES;
}

export function describeDriver(driver: StorageDriver = activeDriver()) {
  return {
    db: "Base de datos (sin servicio externo)",
    blob: "Vercel Blob",
    supabase: "Supabase Storage",
  }[driver];
}

export type StoredFile = {
  storageDriver: StorageDriver;
  storageKey: string | null;
  content: Buffer | null;
};

/** Nombre de archivo seguro para usar como ruta de almacenamiento. */
export function safeName(filename: string) {
  const clean = filename
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .slice(-120);
  return clean || "archivo";
}

export async function putFile(input: { key: string; data: Buffer; contentType: string }): Promise<StoredFile> {
  const driver = activeDriver();
  if (input.data.byteLength > maxBytesFor(driver)) {
    throw new BusinessError(`El archivo supera el máximo permitido (${Math.floor(maxBytesFor(driver) / 1024 / 1024)} MB).`);
  }

  if (driver === "blob") {
    const { put } = await import("@vercel/blob");
    // addRandomSuffix evita choques entre archivos con el mismo nombre.
    const res = await put(input.key, input.data, {
      access: "public",
      contentType: input.contentType,
      addRandomSuffix: true,
    });
    return { storageDriver: "blob", storageKey: res.url, content: null };
  }

  if (driver === "supabase") {
    const url = `${process.env.SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${input.key}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": input.contentType,
        "x-upsert": "true",
      },
      body: new Uint8Array(input.data),
    });
    if (!res.ok) throw new BusinessError(`No se pudo guardar el archivo (${res.status}). Revisa el bucket "${SUPABASE_BUCKET}" en Supabase.`);
    return { storageDriver: "supabase", storageKey: input.key, content: null };
  }

  return { storageDriver: "db", storageKey: null, content: input.data };
}

export async function readFile(file: { storageDriver: string; storageKey: string | null; content: Buffer | null }): Promise<Buffer> {
  if (file.storageDriver === "db") {
    if (!file.content) throw new BusinessError("El archivo ya no está disponible.");
    return Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content);
  }

  if (file.storageDriver === "blob") {
    if (!file.storageKey) throw new BusinessError("El archivo ya no está disponible.");
    const res = await fetch(file.storageKey);
    if (!res.ok) throw new BusinessError("No se pudo descargar el archivo almacenado.");
    return Buffer.from(await res.arrayBuffer());
  }

  const url = `${process.env.SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${file.storageKey}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } });
  if (!res.ok) throw new BusinessError("No se pudo descargar el archivo almacenado.");
  return Buffer.from(await res.arrayBuffer());
}

/** Borra el archivo del servicio externo. Nunca interrumpe la operación del usuario. */
export async function removeFile(file: { storageDriver: string; storageKey: string | null }) {
  try {
    if (file.storageDriver === "blob" && file.storageKey) {
      const { del } = await import("@vercel/blob");
      await del(file.storageKey);
    } else if (file.storageDriver === "supabase" && file.storageKey) {
      await fetch(`${process.env.SUPABASE_URL}/storage/v1/object/${SUPABASE_BUCKET}/${file.storageKey}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
      });
    }
  } catch (error) {
    console.error("No se pudo borrar el archivo almacenado:", error);
  }
}
