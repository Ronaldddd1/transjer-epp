/**
 * Canal cliente para cambios de parámetros de la URL en listados.
 * La barra de filtros se registra como responsable; así búsquedas, filtros y ordenamiento
 * comparten un único estado y no se pisan navegaciones hechas en rápida sucesión.
 */
type Handler = (entries: Record<string, string>, opts?: { keepPage?: boolean }) => void;
let handler: Handler | null = null;

export function registerQueryHandler(h: Handler) {
  handler = h;
  return () => { if (handler === h) handler = null; };
}

/** Devuelve false si no hay barra de filtros montada (se usará la navegación normal). */
export function requestQuery(entries: Record<string, string>, opts?: { keepPage?: boolean }) {
  if (!handler) return false;
  handler(entries, opts);
  return true;
}
