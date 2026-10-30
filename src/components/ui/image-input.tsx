"use client";

import { useRef, useState } from "react";
import { formatFileSize } from "@/lib/utils";

/**
 * Un campo de archivo que achica las fotos antes de subirlas.
 *
 * El problema que resuelve es concreto: una foto de celular pesa hoy entre 4 y 8 MB, y
 * quien subía el sustento de un pago o el papel de un vehículo se topaba con "el archivo
 * supera el máximo permitido" sin tener con qué achicarlo. Y ese peso no aporta nada: un
 * voucher o un SOAT se leen perfectamente a 2.200 píxeles de lado.
 *
 * Lo que hace es redibujar la foto en un canvas con el lado mayor limitado y guardarla como
 * JPEG. Si el resultado no pesa menos, se queda con el original. Los PDF no se tocan: ahí
 * no hay nada que redibujar, y para eso está el tope del servidor.
 *
 * Si el navegador no puede con el canvas, el archivo viaja tal cual y el servidor decide:
 * vale más subir una foto grande que perderla por un error de JavaScript.
 */

/** El lado mayor al que se reduce la foto. Por debajo de esto el texto chico se pierde. */
const LADO_MAXIMO = 2200;
/** Por debajo de esto no vale la pena recomprimir: ya entra sin problema. */
const DESDE_BYTES = 1.2 * 1024 * 1024;
const CALIDAD = 0.82;

async function achicar(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size <= DESDE_BYTES) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height));
    const ancho = Math.round(bitmap.width * escala);
    const alto = Math.round(bitmap.height * escala);

    const lienzo = document.createElement("canvas");
    lienzo.width = ancho;
    lienzo.height = alto;
    const ctx = lienzo.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, ancho, alto);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) => lienzo.toBlob(resolve, "image/jpeg", CALIDAD));
    if (!blob || blob.size >= file.size) return file;

    // El nombre conserva el original para que se reconozca en la lista de archivos, pero
    // con la extensión que corresponde a lo que de verdad se está subiendo.
    const base = file.name.replace(/\.[^.]+$/, "");
    return new File([blob], `${base}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
  } catch {
    return file;
  }
}

export function ImageInput({
  name,
  id,
  accept,
  required = false,
  multiple = false,
  className,
}: {
  name: string;
  id?: string;
  accept?: string;
  required?: boolean;
  multiple?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

  const alElegir = async () => {
    const input = ref.current;
    if (!input?.files?.length) { setAviso(null); return; }

    const originales = Array.from(input.files);
    if (!originales.some((f) => f.type.startsWith("image/") && f.size > DESDE_BYTES)) {
      setAviso(null);
      return;
    }

    setTrabajando(true);
    const achicados = await Promise.all(originales.map(achicar));
    setTrabajando(false);

    const antes = originales.reduce((n, f) => n + f.size, 0);
    const despues = achicados.reduce((n, f) => n + f.size, 0);
    if (despues >= antes) { setAviso(null); return; }

    // Se reemplaza lo que lleva el input, que es lo que viaja en el formulario.
    const lista = new DataTransfer();
    for (const f of achicados) lista.items.add(f);
    input.files = lista.files;
    setAviso(`Foto achicada de ${formatFileSize(antes)} a ${formatFileSize(despues)} para que entre sin problemas.`);
  };

  return (
    <>
      <input
        ref={ref}
        id={id ?? name}
        name={name}
        type="file"
        accept={accept}
        required={required}
        multiple={multiple}
        onChange={alElegir}
        className={className
          ?? "w-full rounded-md border border-steel-300 bg-white p-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-sm file:text-white hover:file:bg-ink-700"}
      />
      {trabajando && <p className="mt-1 text-xs text-steel-500">Achicando la foto…</p>}
      {!trabajando && aviso && <p className="mt-1 text-xs text-steel-500">{aviso}</p>}
    </>
  );
}
