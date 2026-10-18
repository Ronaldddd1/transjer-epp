"use client";

import { HardHat, Search } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { createBulkDelivery } from "@/actions/deliveries";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { DateInput } from "@/components/ui/date-field";
import { FormModal } from "@/components/ui/form-modal";
import type { ProductOption } from "@/components/inventory/movement-modal";
import { cn } from "@/lib/utils";

export type EmployeeOption = { id: string; dni: string; firstName: string; lastName: string; position: string; area: string };

export const DELIVERY_REASONS = ["Entrega inicial", "Renovación", "Cambio por deterioro", "Reposición por pérdida", "Cambio de talla", "Otro"];

type Props = {
  employees: EmployeeOption[];
  products: ProductOption[];
  today: string;
  userName: string;
  employeeId?: string;
  defaultOpen?: boolean;
  variant?: ButtonVariant;
};

/**
 * Entrega de EPP: un trabajador, todos los EPP a la vista.
 *
 * Al abrirse, la lista entera aparece en cero y solo se escriben las cantidades de lo
 * que se está entregando. Antes había que repetir el formulario por cada ítem, y a una
 * persona se le entrega el casco, los guantes, los lentes y las botas de una sola vez:
 * llenar cuatro formularios tomaba más que la entrega misma.
 */
export function DeliveryModal({ employees, products, today, userName, employeeId, defaultOpen, variant = "primary" }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [empId, setEmpId] = useState(employeeId ?? "");
  const [busqueda, setBusqueda] = useState("");
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const emp = employees.find((e) => e.id === empId);

  const limpiar = () => { setCantidades({}); setBusqueda(""); };

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) =>
      `${p.code} ${p.name} ${p.size ?? ""}`.toLowerCase().includes(q));
  }, [products, busqueda]);

  // El resumen se calcula sobre TODOS los productos, no sobre los visibles: lo escrito
  // antes de filtrar sigue contando y se registra igual.
  const elegidos = products
    .map((p) => ({ p, n: Number(cantidades[p.id] ?? "") }))
    .filter(({ n }) => Number.isFinite(n) && n > 0);
  const unidades = elegidos.reduce((s, { n }) => s + n, 0);
  const excedidos = elegidos.filter(({ p, n }) => n > p.stock);

  const escribir = (id: string, valor: string) => {
    setCantidades((c) => ({ ...c, [id]: valor.replace(/[^\d]/g, "") }));
  };

  return (
    <FormModal
      title="Registrar entrega"
      description="Escribe la cantidad de lo que entregas. El stock se descuenta solo y queda en el historial del trabajador."
      submitLabel="Registrar entrega"
      size="lg"
      defaultOpen={defaultOpen}
      onClosed={() => { limpiar(); if (defaultOpen) router.replace(pathname, { scroll: false }); }}
      action={createBulkDelivery}
      trigger={(open) => (
        <Button variant={variant} onClick={open}><HardHat className="h-4 w-4" /> Registrar entrega</Button>
      )}
    >
      {({ errors }) => (
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Trabajador" name="employeeId" required error={errors.employeeId} className="sm:col-span-2">
              <Select name="employeeId" value={empId} onChange={(e) => setEmpId(e.target.value)} invalid={!!errors.employeeId} disabled={!!employeeId}>
                <option value="" disabled>{employees.length ? "Selecciona un trabajador…" : "No hay trabajadores activos"}</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.lastName}, {e.firstName} — DNI {e.dni}</option>)}
              </Select>
              {employeeId && <input type="hidden" name="employeeId" value={employeeId} />}
            </Field>
            <dl className="grid grid-cols-3 gap-2 rounded-md bg-steel-100 px-3 py-2.5 text-sm sm:col-span-2">
              {[["DNI", emp?.dni], ["Cargo", emp?.position], ["Área", emp?.area]].map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-xs text-steel-500">{k}</dt>
                  <dd className="truncate font-medium">{v ?? "—"}</dd>
                </div>
              ))}
            </dl>
            <Field label="Fecha de entrega" name="deliveryDate" required error={errors.deliveryDate}>
              <DateInput name="deliveryDate" defaultValue={today} max={today} required invalid={!!errors.deliveryDate} />
            </Field>
            <Field label="Motivo de entrega" name="reason" required error={errors.reason}>
              <Select name="reason" defaultValue={DELIVERY_REASONS[0]}>
                {DELIVERY_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </Select>
            </Field>
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
              <p className="text-sm font-semibold text-ink">¿Qué se le entrega?</p>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-steel-400" aria-hidden />
                <input
                  type="search"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  placeholder="Buscar EPP"
                  aria-label="Buscar EPP en la lista"
                  className="h-9 w-48 rounded-md border border-steel-300 bg-white pl-8 pr-3 text-sm"
                />
              </div>
            </div>

            <div className="max-h-[22rem] overflow-y-auto rounded-lg border border-steel-200">
              <table className="w-full border-collapse text-left text-sm">
                <thead className="sticky top-0 z-10 bg-steel-50">
                  <tr>
                    <th className="border-b border-steel-200 px-3 py-2 text-[13px] font-semibold text-steel-600">EPP</th>
                    <th className="border-b border-steel-200 px-3 py-2 text-right text-[13px] font-semibold text-steel-600">Stock</th>
                    <th className="w-28 border-b border-steel-200 px-3 py-2 text-right text-[13px] font-semibold text-steel-600">Cantidad</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.length === 0 && (
                    <tr><td colSpan={3} className="px-3 py-8 text-center text-steel-500">
                      {products.length === 0 ? "No hay EPP registrados todavía." : "Ningún EPP coincide con la búsqueda."}
                    </td></tr>
                  )}
                  {visibles.map((p) => {
                    const valor = cantidades[p.id] ?? "";
                    const n = Number(valor || 0);
                    const pasado = n > p.stock;
                    return (
                      <tr key={p.id} className={cn("border-b border-steel-100 last:border-b-0", n > 0 && !pasado && "bg-brand-soft")}>
                        <td className="px-3 py-2">
                          <p className="font-medium">{p.name}{p.size ? <span className="text-steel-500"> · Talla {p.size}</span> : null}</p>
                          <p className="text-xs text-steel-500">{p.code}</p>
                        </td>
                        <td className={cn("px-3 py-2 text-right tabular", p.stock === 0 ? "text-red-600" : "text-steel-600")}>
                          {p.stock === 0 ? "agotado" : p.stock}
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            inputMode="numeric"
                            name={`cantidad_${p.id}`}
                            value={valor}
                            onChange={(e) => escribir(p.id, e.target.value)}
                            disabled={p.stock === 0}
                            placeholder="0"
                            aria-label={`Cantidad de ${p.name}`}
                            aria-invalid={pasado || undefined}
                            className={cn(
                              "h-9 w-full rounded-md border bg-white px-2 text-right tabular disabled:bg-steel-50 disabled:text-steel-400",
                              pasado ? "border-red-500 text-red-700" : "border-steel-300",
                            )}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Lo que se va a registrar, siempre a la vista: con la lista larga es fácil
                perder de vista lo que se escribió más arriba. */}
            <p className={cn("mt-2 text-sm", excedidos.length > 0 ? "text-red-700" : "text-steel-600")}>
              {excedidos.length > 0
                ? `No hay tanto stock de ${excedidos.map(({ p }) => p.name).join(", ")}.`
                : elegidos.length === 0
                  ? "Todavía no has puesto ninguna cantidad."
                  : `Se entregarán ${elegidos.length} EPP · ${unidades} unidad(es): ${elegidos.map(({ p, n }) => `${n} ${p.name}`).join(", ")}.`}
            </p>
          </div>

          <Field label="Observaciones" name="notes" error={errors.notes}>
            <Textarea name="notes" rows={2} maxLength={1000} />
          </Field>
          <p className="text-sm text-steel-500">Responsable: <strong className="text-ink">{userName}</strong></p>
        </div>
      )}
    </FormModal>
  );
}
