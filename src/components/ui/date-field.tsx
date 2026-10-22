"use client";

import { CalendarDays } from "lucide-react";
import { useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { controlClass } from "./field";

/**
 * Campo de fecha en formato peruano.
 *
 * El `<input type="date">` del navegador usa el orden de fechas del idioma del sistema. En una
 * computadora en inglés muestra mm/dd/aaaa, así que quien escribe 03/10/2026 pensando en el 3
 * de octubre registra el 10 de marzo sin enterarse. Además, al teclear números el foco salta
 * solo entre día, mes y año, y si el día tiene dos dígitos salta al siguiente campo del
 * formulario: por eso registrar fechas seguidas resulta tan incómodo.
 *
 * Aquí se escribe sobre un campo de texto normal: las barras se ponen solas, el orden es
 * siempre día/mes/año y el foco no se mueve hasta que la persona lo mueve. El calendario del
 * navegador sigue disponible en el icono de la derecha, y lo que se envía al servidor es la
 * fecha en formato ISO, igual que antes, para no tocar nada del lado del servidor.
 */

/** 2026-10-03 → 03/10/2026 */
export function isoToDisplay(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** 03/10/2026 → 2026-10-03. Devuelve null si la fecha no existe (31/02, por ejemplo). */
export function displayToIso(texto: string): string | null {
  const m = texto.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  const anio = Number(m[3]);
  if (mes < 1 || mes > 12 || dia < 1 || anio < 1900 || anio > 2200) return null;
  // El día debe existir en ese mes: así se rechaza el 31 de abril o el 29 de febrero
  // de un año que no es bisiesto, en lugar de que el navegador lo corra al mes siguiente.
  const ultimoDia = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  if (dia > ultimoDia) return null;
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Va poniendo las barras mientras se escribe, sin estorbar al borrar. */
function conBarras(entrada: string): string {
  const digitos = entrada.replace(/\D/g, "").slice(0, 8);
  if (digitos.length <= 2) return digitos;
  if (digitos.length <= 4) return `${digitos.slice(0, 2)}/${digitos.slice(2)}`;
  return `${digitos.slice(0, 2)}/${digitos.slice(2, 4)}/${digitos.slice(4)}`;
}

type Props = {
  name: string;
  defaultValue?: string | null;
  /** Para usarlo controlado, cuando la pantalla calcula algo con la fecha. */
  value?: string | null;
  onChange?: (iso: string | null) => void;
  min?: string;
  max?: string;
  invalid?: boolean;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  id?: string;
};

export function DateInput({
  name, defaultValue, value, onChange, min, max, invalid, disabled, required, className, id,
}: Props) {
  const controlado = value !== undefined;
  const [iso, setIso] = useState<string>(defaultValue ?? "");
  // Usado controlado, lo que se muestra al abrir sale de `value`, no de `defaultValue`:
  // si no, el campo arranca en blanco aunque el padre ya tenga una fecha puesta.
  const [texto, setTexto] = useState<string>(isoToDisplay(controlado ? value : defaultValue));
  const picker = useRef<HTMLInputElement>(null);
  const propio = useId();
  const campoId = id ?? name ?? propio;

  // Mientras se escribe, el texto manda: así "3/1" no se reescribe solo a medio teclear.
  // Pero si el padre cambia el valor por su cuenta —al limpiar los filtros, por ejemplo—
  // hay que adoptarlo, o el campo seguiría mostrando una fecha que ya nadie tiene.
  const ultimoExterno = useRef<string>(controlado ? (value ?? "") : (defaultValue ?? ""));
  if (controlado && (value ?? "") !== ultimoExterno.current) {
    ultimoExterno.current = value ?? "";
    if (displayToIso(texto) !== (value ?? "") ) setTexto(isoToDisplay(value));
  }

  const isoActual = controlado ? (value ?? "") : iso;

  const aplicar = (nuevoIso: string | null) => {
    ultimoExterno.current = nuevoIso ?? "";
    if (!controlado) setIso(nuevoIso ?? "");
    onChange?.(nuevoIso);
  };

  const alEscribir = (entrada: string) => {
    const formateado = conBarras(entrada);
    setTexto(formateado);
    // Un campo vacío es un valor válido (la fecha opcional que se borra), no una fecha a medias.
    aplicar(formateado === "" ? null : formateado.length === 10 ? displayToIso(formateado) : null);
  };

  const alPegar = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pegado = e.clipboardData.getData("text").trim();
    // Se acepta también el formato ISO, que es lo que sale al copiar de una tabla o del Excel.
    if (/^\d{4}-\d{2}-\d{2}$/.test(pegado)) {
      e.preventDefault();
      setTexto(isoToDisplay(pegado));
      aplicar(pegado);
    }
  };

  const desdeCalendario = (nuevoIso: string) => {
    setTexto(isoToDisplay(nuevoIso));
    aplicar(nuevoIso || null);
  };

  // Una fecha escrita a medias no es un error todavía: solo lo es cuando ya tiene los
  // ocho dígitos y aun así no corresponde a un día real, o se sale del rango permitido.
  const completa = texto.length === 10;
  const fueraDeRango = !!isoActual && ((min && isoActual < min) || (max && isoActual > max));
  const malEscrita = completa && !displayToIso(texto);
  const conError = invalid || malEscrita || !!fueraDeRango;

  return (
    <div className={cn("relative", className)}>
      <input
        id={campoId}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="dd/mm/aaaa"
        maxLength={10}
        value={texto}
        onChange={(e) => alEscribir(e.target.value)}
        onPaste={alPegar}
        disabled={disabled}
        aria-invalid={conError || undefined}
        aria-describedby={conError ? `${campoId}-fecha-error` : undefined}
        className={cn(controlClass, "h-10 pr-10 tabular-nums")}
      />

      {/* El campo nativo queda invisible encima del icono: al pulsarlo abre el calendario
          del navegador, en escritorio y en el celular, sin depender de showPicker(). */}
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden
        disabled={disabled}
        value={isoActual}
        min={min}
        max={max}
        onChange={(e) => desdeCalendario(e.target.value)}
        onClick={() => { try { picker.current?.showPicker?.(); } catch { /* el navegador lo abrirá solo */ } }}
        className="absolute inset-y-0 right-0 w-10 cursor-pointer opacity-0"
      />
      <CalendarDays className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel-400" aria-hidden />

      {/* Lo que viaja al servidor sigue siendo la fecha en ISO, como antes. */}
      <input type="hidden" name={name} value={isoActual} />
      {required && (
        <input
          type="text"
          required
          tabIndex={-1}
          aria-hidden
          value={isoActual}
          onChange={() => {}}
          className="pointer-events-none absolute bottom-0 left-3 h-0 w-0 opacity-0"
        />
      )}

      {malEscrita && (
        <p id={`${campoId}-fecha-error`} className="mt-1 text-sm text-red-600">Esa fecha no existe.</p>
      )}
      {!malEscrita && fueraDeRango && (
        <p id={`${campoId}-fecha-error`} className="mt-1 text-sm text-red-600">
          {max && isoActual > max ? "La fecha no puede ser posterior a hoy." : "La fecha está fuera del rango permitido."}
        </p>
      )}
    </div>
  );
}
