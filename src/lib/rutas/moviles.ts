/**
 * Lee las móviles del día del formulario de "Calcular rutas". Cada fila trae
 * usar_<id>, placa_<id>, kg_<id>, m3_<id> y max_<id>; las de terceros usan ids
 * "tercero1", "tercero2"…
 */

export type MovilElegida = {
  vehicleId: string | null; plate: string; capacidadKg: number | null; capacidadM3: number | null; maxParadas: number | null;
};

const numeroONulo = (v: FormDataEntryValue | null) => {
  const t = String(v ?? "").trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 ? n : NaN;
};

/** Las móviles del formulario: las de la flota marcadas y las de terceros escritas. */
export function leerMoviles(formData: FormData): { moviles: MovilElegida[]; errores: Record<string, string> } {
  const moviles: MovilElegida[] = [];
  const errores: Record<string, string> = {};
  const filas = new Set<string>();
  for (const k of formData.keys()) {
    const m = k.match(/^usar_(.+)$/);
    if (m) filas.add(m[1]);
  }
  for (const f of filas) {
    if (formData.get(`usar_${f}`) !== "on") continue;
    const plate = String(formData.get(`placa_${f}`) ?? "").trim().toUpperCase();
    const kg = numeroONulo(formData.get(`kg_${f}`));
    const m3 = numeroONulo(formData.get(`m3_${f}`));
    const max = numeroONulo(formData.get(`max_${f}`));
    if (!plate) errores[`placa_${f}`] = "Escribe la placa";
    if (Number.isNaN(kg)) errores[`kg_${f}`] = "Kg inválidos";
    if (Number.isNaN(m3)) errores[`m3_${f}`] = "m³ inválidos";
    if (Number.isNaN(max) || (max != null && !Number.isInteger(max))) errores[`max_${f}`] = "Número entero";
    moviles.push({
      vehicleId: f.startsWith("tercero") ? null : f, plate: plate.slice(0, 20),
      capacidadKg: Number.isNaN(kg) ? null : kg, capacidadM3: Number.isNaN(m3) ? null : m3,
      maxParadas: Number.isNaN(max) ? null : max,
    });
  }
  return { moviles, errores };
}

