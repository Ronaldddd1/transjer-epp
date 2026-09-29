"use client";

import { CalendarRange, Table2 } from "lucide-react";
import { useMemo, useState } from "react";
import { saveSchedule } from "@/actions/obligations";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormModal } from "@/components/ui/form-modal";
import {
  applyMapping, buildSchedule, detectSchedule, type ColumnMapping, type ScheduleImportRow,
} from "@/lib/amortization";
import { cn, formatDate, formatMoney, todayLima } from "@/lib/utils";

/**
 * Carga del cronograma de un préstamo.
 *
 * Dos caminos, porque los dos hacen falta:
 *
 *   Pegar   Es el fiable. Se copian las filas del PDF del banco y el sistema propone qué
 *           es cada columna, porque cada banco las ordena distinto. La propuesta se puede
 *           corregir antes de guardar, así nunca se guarda algo mal asignado en silencio.
 *
 *   Generar Calcula el cronograma a partir del capital, la tasa y las fechas. Sirve para no
 *           tipear 24 filas, pero es un borrador: cuadra al céntimo con unos bancos y se
 *           desvía unos soles con otros, según cómo liquiden el primer período.
 */

type Props = {
  obligationId: string;
  currency: string;
  principal: string | null;
  annualRate: string | null;
  disbursedAt: string | null;
  hasSchedule: boolean;
};

type Modo = "pegar" | "generar";

const CAMPOS: { key: keyof ColumnMapping; label: string; required?: boolean }[] = [
  { key: "total", label: "Cuota total", required: true },
  { key: "principal", label: "Capital" },
  { key: "interest", label: "Interés" },
  { key: "insurance", label: "Seguro" },
  { key: "balance", label: "Saldo" },
];

export function ScheduleImportModal({ obligationId, currency, principal, annualRate, disbursedAt, hasSchedule }: Props) {
  const [modo, setModo] = useState<Modo>("pegar");

  // --- Pegar ---
  const [texto, setTexto] = useState("");
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);

  const detectado = useMemo(() => {
    if (!texto.trim()) return null;
    const d = detectSchedule(texto);
    return d;
  }, [texto]);

  const tabla = detectado && !("error" in detectado) ? detectado : null;
  const mapaActual = mapping ?? tabla?.guess ?? null;

  const pegadas = useMemo(() => {
    if (!tabla || !mapaActual) return { rows: [] as ScheduleImportRow[], errors: [] as string[] };
    return applyMapping(tabla, mapaActual);
  }, [tabla, mapaActual]);

  // --- Generar ---
  const [capital, setCapital] = useState(principal ?? "");
  const [tasa, setTasa] = useState(annualRate ?? "");
  const [cuotas, setCuotas] = useState("24");
  const [primera, setPrimera] = useState("");
  const [desembolso, setDesembolso] = useState(disbursedAt ?? "");
  const [seguro, setSeguro] = useState("");

  const generado = useMemo(() => {
    if (modo !== "generar") return { rows: [] as ScheduleImportRow[], error: null as string | null };
    if (!capital || !tasa || !cuotas || !primera || !desembolso) return { rows: [], error: null };
    try {
      const rows = buildSchedule({
        principal: Number(capital),
        annualRate: Number(tasa),
        installments: Number(cuotas),
        firstDueDate: primera,
        disbursedAt: desembolso,
        insuranceRate: seguro ? Number(seguro) : undefined,
      }).map((r) => ({
        number: r.number,
        dueDate: r.dueDate,
        principal: r.principal,
        interest: r.interest,
        insurance: r.insurance || null,
        total: r.total,
        balanceAfter: r.balanceAfter,
      }));
      return { rows, error: null };
    } catch (e) {
      return { rows: [], error: e instanceof Error ? e.message : "No se pudo calcular el cronograma." };
    }
  }, [modo, capital, tasa, cuotas, primera, desembolso, seguro]);

  const filas = modo === "pegar" ? pegadas.rows : generado.rows;
  const suma = filas.reduce((s, r) => s + r.total, 0);

  return (
    <FormModal
      title={hasSchedule ? "Reemplazar cronograma" : "Cargar cronograma"}
      description="Pega las filas del cronograma del banco, o calcúlalo con la tasa y el plazo."
      submitLabel={filas.length ? `Guardar ${filas.length} cuotas` : "Guardar cronograma"}
      size="lg"
      action={(fd) => saveSchedule(obligationId, fd)}
      trigger={(open) => (
        <Button variant={hasSchedule ? "outline" : "primary"} onClick={open}>
          <Table2 className="h-4 w-4" /> {hasSchedule ? "Reemplazar cronograma" : "Cargar cronograma"}
        </Button>
      )}
    >
      {({ errors }) => (
        <div className="grid gap-4">
          <input type="hidden" name="rows" value={JSON.stringify(filas)} />

          {hasSchedule && (
            <p className="rounded-md border border-brand/60 bg-brand-soft px-3 py-2 text-sm text-[#7A5A00]">
              Ya hay un cronograma cargado. Al guardar se reemplaza entero. Si alguna cuota ya figura
              pagada, el sistema no dejará hacerlo.
            </p>
          )}

          <div className="flex gap-1 rounded-lg border border-steel-200 bg-steel-50 p-1">
            {([["pegar", "Pegar del banco", Table2], ["generar", "Calcular", CalendarRange]] as const).map(([v, l, Icon]) => (
              <button
                key={v}
                type="button"
                onClick={() => setModo(v)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold",
                  modo === v ? "bg-white text-ink shadow-sm" : "text-steel-500 hover:text-ink",
                )}
              >
                <Icon className="h-4 w-4" /> {l}
              </button>
            ))}
          </div>

          {modo === "pegar" ? (
            <>
              <Field
                label="Filas del cronograma"
                name="pegado"
                hint="Copia las filas del PDF o del Excel del banco, con encabezados o sin ellos. Da igual el orden de las columnas."
              >
                <Textarea
                  id="pegado"
                  value={texto}
                  onChange={(e) => { setTexto(e.target.value); setMapping(null); }}
                  rows={6}
                  className="font-mono text-xs"
                  placeholder={"1  08/06/2026  250,012.50  7,369.98  4,955.08  0.00  12,325.06\n2  08/07/2026  242,642.52  9,129.55  3,195.51  0.00  12,325.06"}
                />
              </Field>

              {detectado && "error" in detectado && (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{detectado.error}</p>
              )}

              {tabla && mapaActual && (
                <div className="rounded-lg border border-steel-200 bg-steel-50 p-4">
                  <p className="text-sm font-semibold text-ink">Qué es cada columna</p>
                  <p className="mt-0.5 text-sm text-steel-600">
                    Cada banco las ordena distinto, así que revisa la propuesta antes de guardar.
                    El saldo, si el banco lo imprime, se guarda tal cual para que la ficha cuadre con el papel.
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-5">
                    {CAMPOS.map(({ key, label, required }) => (
                      <Field key={key} label={label} name={`col-${key}`} required={required}>
                        <Select
                          id={`col-${key}`}
                          value={mapaActual[key] === null ? "" : String(mapaActual[key])}
                          onChange={(e) => setMapping({ ...mapaActual, [key]: e.target.value === "" ? null : Number(e.target.value) })}
                        >
                          <option value="">—</option>
                          {tabla.amountColumns.map((c) => (
                            <option key={c} value={c}>
                              Columna {c + 1} · {tabla.cells[0]?.[c] ?? ""}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    ))}
                  </div>
                </div>
              )}

              {pegadas.errors.length > 0 && (
                <ul className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                  {pegadas.errors.slice(0, 4).map((e) => <li key={e}>{e}</li>)}
                  {pegadas.errors.length > 4 && <li>…y {pegadas.errors.length - 4} aviso(s) más.</li>}
                </ul>
              )}
            </>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-6">
                <Field label="Capital" name="gen-capital" required className="sm:col-span-2">
                  <Input id="gen-capital" value={capital} onChange={(e) => setCapital(e.target.value)} inputMode="decimal" placeholder="250000" />
                </Field>
                <Field label="TEA (%)" name="gen-tasa" required className="sm:col-span-2">
                  <Input id="gen-tasa" value={tasa} onChange={(e) => setTasa(e.target.value)} inputMode="decimal" placeholder="17" />
                </Field>
                <Field label="Nº de cuotas" name="gen-cuotas" required className="sm:col-span-2">
                  <Input id="gen-cuotas" value={cuotas} onChange={(e) => setCuotas(e.target.value)} inputMode="numeric" />
                </Field>
                <Field label="Desembolso" name="gen-desembolso" required className="sm:col-span-2">
                  <Input id="gen-desembolso" type="date" value={desembolso} onChange={(e) => setDesembolso(e.target.value)} />
                </Field>
                <Field label="Primera cuota vence" name="gen-primera" required className="sm:col-span-2">
                  <Input id="gen-primera" type="date" value={primera} onChange={(e) => setPrimera(e.target.value)} />
                </Field>
                <Field label="Desgravamen (% anual)" name="gen-seguro" className="sm:col-span-2">
                  <Input id="gen-seguro" value={seguro} onChange={(e) => setSeguro(e.target.value)} inputMode="decimal" placeholder="1.08" />
                </Field>
              </div>
              {generado.error && (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{generado.error}</p>
              )}
              <p className="rounded-md border border-steel-200 bg-steel-50 px-3 py-2 text-sm text-steel-600">
                El cálculo usa la TEA sobre días reales, que es como liquidan los bancos peruanos.
                Aun así es un borrador: contra el papel del banco puede haber unos céntimos de
                diferencia, y algunos soles si cobran el primer período con otro criterio.
                Si el cronograma impreso está a mano, conviene pegarlo.
              </p>
            </>
          )}

          {filas.length > 0 && (
            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-ink">
                  {filas.length} cuotas · {formatDate(filas[0].dueDate)} a {formatDate(filas[filas.length - 1].dueDate)}
                </p>
                <p className="text-sm text-steel-600">
                  Total a pagar: <strong className="text-ink">{formatMoney(suma.toFixed(2), currency)}</strong>
                </p>
              </div>
              <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-steel-200">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-steel-50 text-xs uppercase tracking-wide text-steel-500">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">N.º</th>
                      <th className="px-3 py-2 text-left font-semibold">Vence</th>
                      <th className="px-3 py-2 text-right font-semibold">Capital</th>
                      <th className="px-3 py-2 text-right font-semibold">Interés</th>
                      <th className="px-3 py-2 text-right font-semibold">Seguro</th>
                      <th className="px-3 py-2 text-right font-semibold">Cuota</th>
                      <th className="px-3 py-2 text-right font-semibold">Saldo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-steel-100">
                    {filas.map((r) => (
                      <tr key={r.number}>
                        <td className="px-3 py-1.5 tabular text-steel-500">{r.number}</td>
                        <td className="px-3 py-1.5 tabular">{formatDate(r.dueDate)}</td>
                        <td className="px-3 py-1.5 text-right tabular text-steel-600">{r.principal?.toFixed(2) ?? "—"}</td>
                        <td className="px-3 py-1.5 text-right tabular text-steel-600">{r.interest?.toFixed(2) ?? "—"}</td>
                        <td className="px-3 py-1.5 text-right tabular text-steel-600">{r.insurance?.toFixed(2) ?? "—"}</td>
                        <td className="px-3 py-1.5 text-right font-semibold tabular">{r.total.toFixed(2)}</td>
                        <td className="px-3 py-1.5 text-right tabular text-steel-500">{r.balanceAfter?.toFixed(2) ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {errors.rows && <p className="text-sm text-red-700">{errors.rows}</p>}
          {errors.form && <p className="text-sm text-red-700">{errors.form}</p>}
        </div>
      )}
    </FormModal>
  );
}

/** Fecha de hoy, por si hace falta un valor por defecto al abrir. */
export const HOY = todayLima;
