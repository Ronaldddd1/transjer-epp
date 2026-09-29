/**
 * Cronogramas de préstamos.
 *
 * Los bancos peruanos publican la Tasa Efectiva Anual (TEA) y liquidan el interés por días
 * reales sobre un año de 360, no por meses iguales:
 *
 *     interés del período = saldo × ((1 + TEA)^(días/360) − 1)
 *
 * Por eso el primer período, que suele ser más largo por los días de gracia, cobra más
 * interés que los siguientes, y los meses de 31 días cobran algo más que los de 28. Con la
 * fórmula francesa de meses iguales el resultado se desvía varios soles; con días reales
 * cuadra al céntimo con los cronogramas de BCP e Interbank.
 *
 * La cuota constante no tiene fórmula cerrada cuando los períodos son desiguales, así que se
 * busca por bisección: la cuota correcta es la que deja el saldo en cero en la última fila.
 *
 * Esto genera un borrador. El cronograma que manda es el papel del banco, así que la pantalla
 * permite corregir cualquier fila antes de guardar.
 */

const DAY = 86_400_000;

export type ScheduleInput = {
  /** Capital desembolsado. */
  principal: number;
  /** Tasa efectiva anual, en porcentaje: 17 para 17 %. */
  annualRate: number;
  /** Cuántas cuotas. */
  installments: number;
  /** Vencimiento de la primera cuota, YYYY-MM-DD. */
  firstDueDate: string;
  /** Desembolso, YYYY-MM-DD. Define los días del primer período. */
  disbursedAt: string;
  /** Seguro de desgravamen mensual sobre el saldo, en porcentaje anual. Opcional. */
  insuranceRate?: number;
};

export type ScheduleRow = {
  number: number;
  dueDate: string;
  days: number;
  principal: number;
  interest: number;
  insurance: number;
  total: number;
  balanceAfter: number;
};

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY);
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Vencimientos mensuales a partir del primero, manteniendo el día del mes.
 * Si el día no existe en un mes (31 en febrero), cae en el último día de ese mes.
 */
export function monthlyDueDates(firstDueDate: string, count: number): string[] {
  const [y, m, d] = firstDueDate.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const month = m - 1 + i;
    const year = y + Math.floor(month / 12);
    const mon = ((month % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(year, mon + 1, 0)).getUTCDate();
    const day = Math.min(d, lastDay);
    out.push(`${year}-${String(mon + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  return out;
}

/** Factor de interés de un período: cuánto rinde la TEA en `days` días. */
function periodRate(annualRate: number, days: number): number {
  return Math.pow(1 + annualRate / 100, days / 360) - 1;
}

/** Saldo que queda al final si se paga `payment` en cada cuota. Negativo = se pagó de más. */
function finalBalance(input: ScheduleInput, dueDates: string[], payment: number): number {
  let balance = input.principal;
  let previous = input.disbursedAt;
  for (const due of dueDates) {
    const interest = balance * periodRate(input.annualRate, daysBetween(previous, due));
    balance = balance + interest - payment;
    previous = due;
  }
  return balance;
}

/**
 * Cronograma completo con cuota constante.
 * Lanza si los datos no permiten un cronograma razonable.
 */
export function buildSchedule(input: ScheduleInput): ScheduleRow[] {
  if (!(input.principal > 0)) throw new Error("El capital debe ser mayor a 0.");
  if (input.installments < 1 || input.installments > 360) throw new Error("El número de cuotas debe estar entre 1 y 360.");
  if (input.annualRate < 0 || input.annualRate > 200) throw new Error("La tasa anual debe estar entre 0 y 200 %.");
  if (input.firstDueDate <= input.disbursedAt) throw new Error("La primera cuota debe vencer después del desembolso.");

  const dueDates = monthlyDueDates(input.firstDueDate, input.installments);

  // Bisección sobre la cuota. El mínimo es 0 y el máximo, todo el capital más sus intereses
  // en una sola cuota, que siempre deja saldo negativo.
  let low = 0;
  let high = input.principal * (1 + periodRate(input.annualRate, daysBetween(input.disbursedAt, dueDates[dueDates.length - 1]))) + 1;
  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2;
    if (finalBalance(input, dueDates, mid) > 0) low = mid;
    else high = mid;
  }
  const payment = round2((low + high) / 2);

  const rows: ScheduleRow[] = [];
  let balance = input.principal;
  let previous = input.disbursedAt;

  dueDates.forEach((due, index) => {
    const days = daysBetween(previous, due);
    const isLast = index === dueDates.length - 1;
    const interest = round2(balance * periodRate(input.annualRate, days));
    // El desgravamen se cobra a tasa simple sobre el saldo, no compuesta como el interés.
    const insurance = input.insuranceRate ? round2((balance * input.insuranceRate / 100) * days / 360) : 0;

    // La última cuota cancela el saldo exacto, que es como lo hacen los bancos: por eso
    // suele ser unos céntimos distinta de las demás.
    const principal = isLast ? round2(balance) : round2(payment - interest);
    const total = round2(principal + interest + insurance);
    balance = round2(balance - principal);

    rows.push({ number: index + 1, dueDate: due, days, principal, interest, insurance, total, balanceAfter: balance });
    previous = due;
  });

  return rows;
}

/** 12,271.75 → 12271.75 · 1.234,56 → 1234.56 · vacío → null */
function parseAmount(raw: string): number | null {
  const text = raw.trim().replace(/[^\d.,-]/g, "");
  if (!text) return null;
  // Se decide el separador decimal por el último que aparece.
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  let normalized = text;
  if (lastComma > lastDot) normalized = text.replace(/\./g, "").replace(",", ".");
  else normalized = text.replace(/,/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** 08/06/2026 · 6/11/25 · 160225 (ddmmaa) · 2026-06-08 → YYYY-MM-DD */
export function parseScheduleDate(raw: string): string | null {
  const text = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const slash = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (slash) {
    const [, d, m, y] = slash;
    const year = y.length === 2 ? 2000 + Number(y) : Number(y);
    return `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // Formato compacto de los cronogramas del BCP: ddmmaa.
  const compact = text.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (compact) {
    const [, d, m, y] = compact;
    return `${2000 + Number(y)}-${m}-${d}`;
  }
  return null;
}

/**
 * Cada banco ordena las columnas a su manera. El BCP imprime el saldo antes de la
 * amortización; el Préstamo Fácil de Interbank lo imprime al final, después de la cuota;
 * el crédito Pyme no imprime saldo. Por eso no se adivina por posición: se detectan las
 * columnas, se propone una asignación y la pantalla deja que la persona la corrija antes
 * de guardar nada.
 */
export type DetectedSchedule = {
  /** Filas que contienen una fecha, ya partidas en celdas. */
  cells: string[][];
  /** Índice de la columna con las fechas. */
  dateColumn: number;
  /** Fechas ya normalizadas, una por fila. */
  dueDates: string[];
  /** Índices de las columnas que traen importes. */
  amountColumns: number[];
  /** Propuesta de asignación; cada valor es un índice de columna. */
  guess: ColumnMapping;
};

export type ColumnMapping = {
  total: number | null;
  principal: number | null;
  interest: number | null;
  insurance: number | null;
  /** Saldo de capital que queda tras la cuota, cuando el banco lo imprime. */
  balance: number | null;
};

export type ScheduleImportRow = {
  number: number;
  dueDate: string;
  principal: number | null;
  interest: number | null;
  insurance: number | null;
  total: number;
  balanceAfter: number | null;
};

function columnValues(cells: string[][], column: number): (number | null)[] {
  return cells.map((row) => parseAmount(row[column] ?? ""));
}

/** Cuánto varía una columna respecto a su promedio. La cuota de un préstamo casi no varía. */
function variation(values: number[]): number {
  if (values.length < 2) return Number.POSITIVE_INFINITY;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (mean === 0) return Number.POSITIVE_INFINITY;
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  return sd / mean;
}

/** Qué tan monótona es una columna: +1 sube siempre, −1 baja siempre. */
function trend(values: number[]): number {
  let up = 0;
  let down = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[i - 1]) up++;
    else if (values[i] < values[i - 1]) down++;
  }
  const total = up + down;
  return total === 0 ? 0 : (up - down) / total;
}

/**
 * Lee un cronograma pegado desde el PDF del banco o desde Excel y propone qué es cada columna.
 * Acepta celdas separadas por tabulaciones, punto y coma, barras o dos o más espacios.
 */
export function detectSchedule(text: string): DetectedSchedule | { error: string } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const cells: string[][] = [];
  const dueDates: string[] = [];
  let dateColumn = -1;

  for (const line of lines) {
    const row = line.split(/\t|;|\s*\|\s*|\s{2,}|\s+/).map((c) => c.trim()).filter(Boolean);
    if (row.length < 2) continue;
    // La columna de fechas es la primera celda de la fila que se lee como fecha.
    const index = row.findIndex((c) => parseScheduleDate(c) !== null);
    if (index === -1) continue; // Encabezado, pie o línea de totales.
    const due = parseScheduleDate(row[index])!;
    if (dateColumn === -1) dateColumn = index;
    else if (index !== dateColumn) continue; // Fila desalineada: mejor descartarla que inventarla.
    cells.push(row);
    dueDates.push(due);
  }

  if (cells.length === 0) {
    return { error: "No se reconoció ninguna fila. Cada línea debe traer la fecha de vencimiento y el importe de la cuota." };
  }

  const width = Math.max(...cells.map((r) => r.length));
  const amountColumns: number[] = [];
  for (let c = 0; c < width; c++) {
    if (c === dateColumn) continue;
    const values = columnValues(cells, c);
    const numeric = values.filter((v): v is number => v !== null);
    // Se descarta la columna del número de cuota: enteros chicos y correlativos.
    const looksLikeIndex = numeric.length === cells.length && numeric.every((v) => Number.isInteger(v) && v <= 400);
    if (numeric.length >= cells.length * 0.8 && !looksLikeIndex) amountColumns.push(c);
  }

  const stats = amountColumns.map((c) => {
    const values = columnValues(cells, c).map((v) => v ?? 0);
    const max = Math.max(...values);
    return { column: c, values, max, variation: variation(values), trend: trend(values) };
  });

  const withMoney = stats.filter((s) => s.max > 0);
  // La cuota es la columna de importes que menos varía: en un préstamo es casi constante.
  const totalStat = withMoney.slice().sort((a, b) => a.variation - b.variation)[0] ?? null;
  const total = totalStat?.column ?? null;

  // El saldo es mucho mayor que la cuota y siempre baja. Los bancos lo imprimen en sitios
  // distintos —el BCP antes del desglose, el Préstamo Fácil al final— así que se reconoce
  // por su forma, no por su posición, y se guarda tal cual en vez de recalcularlo: así la
  // ficha cuadra al céntimo con el papel del banco.
  const cuota = totalStat ? Math.max(...totalStat.values) : 0;
  const grandes = withMoney.filter((s) => s.column !== total && s.max > cuota * 3);
  const balance = grandes.filter((s) => s.trend < 0).sort((a, b) => b.max - a.max)[0]?.column ?? null;

  const candidates = withMoney.filter((s) => s.column !== total && s.column !== balance && s.max <= cuota * 3);

  // En cualquier cronograma francés el capital sube cuota a cuota y el interés baja.
  const principal = candidates.filter((s) => s.trend > 0).sort((a, b) => b.trend - a.trend)[0]?.column ?? null;
  const interest = candidates.filter((s) => s.trend < 0 && s.column !== principal).sort((a, b) => a.trend - b.trend)[0]?.column ?? null;
  const insurance = candidates.find((s) => s.column !== principal && s.column !== interest)?.column ?? null;

  return { cells, dateColumn, dueDates, amountColumns, guess: { total, principal, interest, insurance, balance } };
}

/**
 * Los bancos no usan la columna de saldo con el mismo significado.
 *
 *   El BCP y la Banca Pequeña Empresa de Interbank imprimen el saldo que se DEBE al empezar
 *   el período: en la primera fila sale el préstamo entero.
 *
 *   El Préstamo Fácil de Interbank imprime el que QUEDA después de pagar la cuota.
 *
 * Se distingue por aritmética, no por el nombre del banco: la diferencia entre dos saldos
 * consecutivos es el capital de la fila de arriba si el saldo es "antes", y el de la fila de
 * abajo si es "después". Guardar el sentido equivocado haría que la ficha mostrara como
 * pendiente un dinero que ya se pagó.
 */
function saldoEsAntesDeLaCuota(saldos: (number | null)[], capitales: (number | null)[]): boolean {
  let antes = 0;
  let despues = 0;
  for (let i = 0; i + 1 < saldos.length; i++) {
    const a = saldos[i];
    const b = saldos[i + 1];
    if (a === null || b === null) continue;
    const diferencia = a - b;
    if (capitales[i] !== null && Math.abs(diferencia - capitales[i]!) <= 0.05) antes++;
    if (capitales[i + 1] !== null && Math.abs(diferencia - capitales[i + 1]!) <= 0.05) despues++;
  }
  // Empate o sin datos: se toma "después", que es lo que el sistema guarda.
  return antes > despues;
}

/** Convierte la tabla detectada en las filas que se van a guardar, con la asignación elegida. */
export function applyMapping(detected: DetectedSchedule, mapping: ColumnMapping): { rows: ScheduleImportRow[]; errors: string[] } {
  const errors: string[] = [];
  if (mapping.total === null) return { rows: [], errors: ["Indica cuál columna trae el importe de la cuota."] };

  const value = (row: string[], column: number | null) => (column === null ? null : parseAmount(row[column] ?? ""));

  const rows: ScheduleImportRow[] = [];
  detected.cells.forEach((row, index) => {
    const total = value(row, mapping.total);
    if (total === null || !(total > 0)) {
      errors.push(`Cuota ${index + 1} (${detected.dueDates[index]}): el importe no es válido.`);
      return;
    }
    rows.push({
      number: index + 1,
      dueDate: detected.dueDates[index],
      principal: value(row, mapping.principal),
      interest: value(row, mapping.interest),
      insurance: value(row, mapping.insurance),
      total,
      balanceAfter: value(row, mapping.balance),
    });
  });

  // El saldo se normaliza siempre a "lo que queda después de pagar esta cuota", que es
  // lo que guarda el sistema y lo que la persona quiere ver en la ficha.
  if (mapping.balance !== null && rows.length > 1) {
    const saldos = rows.map((r) => r.balanceAfter);
    const capitales = rows.map((r) => r.principal);
    if (saldoEsAntesDeLaCuota(saldos, capitales)) {
      rows.forEach((r) => {
        r.balanceAfter = r.balanceAfter !== null && r.principal !== null
          ? Math.round((r.balanceAfter - r.principal) * 100) / 100
          : null;
      });
    }
  }

  // Aviso, no error: el desglose puede venir incompleto y la cuota sigue siendo válida.
  rows.forEach((r) => {
    if (r.principal !== null && r.interest !== null) {
      const suma = r.principal + r.interest + (r.insurance ?? 0);
      if (Math.abs(suma - r.total) > 0.05) {
        errors.push(`Cuota ${r.number}: capital + interés + seguro da ${suma.toFixed(2)} y la cuota dice ${r.total.toFixed(2)}. Revisa la asignación de columnas.`);
      }
    }
  });

  return { rows, errors };
}
