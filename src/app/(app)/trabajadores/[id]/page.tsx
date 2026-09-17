import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DeliveryModal } from "@/components/deliveries/delivery-modal";
import { VoidDeliveryModal } from "@/components/deliveries/void-delivery-modal";
import { EmployeeFormModal } from "@/components/employees/employee-form-modal";
import { Badge, VoidedNote } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Panel } from "@/components/ui/page-header";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { cn, formatDate, todayLima } from "@/lib/utils";
import { getEmployee, getEmployeeOptions, getProductOptions, listDeliveries } from "@/server/queries";

export const metadata: Metadata = { title: "Historial del trabajador" };

export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser("employees.view");
  const { id } = await params;
  const employee = await getEmployee(id);
  if (!employee) notFound();

  const canDeliver = can(user.role, "deliveries.create") && employee.active;
  const [{ rows }, products, employees] = await Promise.all([
    listDeliveries({ employeeId: id }),
    canDeliver ? getProductOptions() : Promise.resolve([]),
    canDeliver ? getEmployeeOptions() : Promise.resolve([]),
  ]);
  const canVoid = can(user.role, "deliveries.void");
  // Las entregas anuladas se muestran en el historial, pero no cuentan en los totales.
  const valid = rows.filter((r) => !r.voidedAt);
  const totalUnits = valid.reduce((s, r) => s + r.quantity, 0);
  const lastDate = valid[0]?.deliveryDate;

  // Resumen por EPP: qué tiene y cuándo lo recibió por última vez
  const byProduct = new Map<string, { name: string; size: string | null; qty: number; last: string }>();
  for (const r of valid) {
    const key = `${r.productCode}|${r.size ?? ""}`;
    const cur = byProduct.get(key);
    if (cur) cur.qty += r.quantity;
    else byProduct.set(key, { name: r.productName, size: r.size, qty: r.quantity, last: r.deliveryDate });
  }

  return (
    <>
      <Link href="/trabajadores" className="mb-4 inline-flex items-center gap-1 text-sm text-steel-600 hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Trabajadores
      </Link>

      <div className="mb-6 flex flex-col gap-4 rounded-lg border border-steel-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-ink font-display text-xl font-bold text-brand">
            {employee.firstName.charAt(0)}{employee.lastName.charAt(0)}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl font-bold leading-tight sm:text-3xl">{employee.firstName} {employee.lastName}</h1>
              {employee.active ? <Badge tone="green">Activo</Badge> : <Badge>Inactivo</Badge>}
            </div>
            <p className="text-steel-600">{employee.position} · {employee.area}</p>
            <p className="text-sm text-steel-500">
              DNI {employee.dni}
              {employee.phone && <> · Tel. {employee.phone}</>}
              {employee.hireDate && <> · Ingreso {formatDate(employee.hireDate)}</>}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canDeliver && <DeliveryModal employees={employees} products={products} today={todayLima()} userName={user.name} employeeId={employee.id} />}
          {can(user.role, "employees.manage") && <EmployeeFormModal employee={employee} />}
          {can(user.role, "reports.view") && <ButtonLink href={`/reportes?tipo=entregas&employee=${employee.id}`} variant="ghost">Exportar</ButtonLink>}
        </div>
      </div>

      {employee.notes && <p className="mb-6 rounded-md border-l-4 border-brand bg-white px-4 py-3 text-sm text-ink-700">{employee.notes}</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="min-w-0">
          <h2 className="mb-3 font-display text-xl font-semibold">Historial de EPP entregados</h2>
          <TableShell>
            <thead>
              <tr><Th>Fecha</Th><Th>EPP</Th><Th>Talla</Th><Th className="text-right">Cantidad</Th><Th>Motivo</Th><Th>Responsable</Th>{canVoid && <Th className="text-right"><span className="sr-only">Acciones</span></Th>}</tr>
            </thead>
            <tbody>
              {rows.length === 0 && <EmptyRow colSpan={canVoid ? 7 : 6} title="Este trabajador aún no ha recibido EPP" />}
              {rows.map((r) => (
                <Tr key={r.id} className={cn(r.voidedAt && "bg-steel-50/60 [&>td]:text-steel-400")}>
                  <Td className="whitespace-nowrap tabular text-steel-600">{formatDate(r.deliveryDate)}</Td>
                  <Td className="font-medium">{r.productName}</Td>
                  <Td>{r.size ?? "—"}</Td>
                  <Td className={cn("text-right font-display text-lg font-bold tabular", r.voidedAt && "line-through")}>{r.quantity}</Td>
                  <Td>
                    {r.reason}{r.notes && <p className="text-xs text-steel-500">{r.notes}</p>}
                    {r.voidedAt && <VoidedNote voidedAt={r.voidedAt} voidedByName={r.voidedByName} voidReason={r.voidReason} />}
                  </Td>
                  <Td className="text-steel-600">{r.userName}</Td>
                  {canVoid && (
                    <Td className="text-right">
                      {!r.voidedAt && (
                        <VoidDeliveryModal
                          delivery={{ id: r.id, deliveryDate: r.deliveryDate, employeeName: r.employeeName, productName: r.productName, size: r.size, quantity: r.quantity }}
                          dateLabel={formatDate(r.deliveryDate)}
                        />
                      )}
                    </Td>
                  )}
                </Tr>
              ))}
            </tbody>
          </TableShell>
        </section>

        <aside className="grid min-w-0 content-start gap-4">
          <Panel>
            <dl className="grid grid-cols-2 divide-x divide-steel-200">
              <div className="p-4"><dt className="text-xs text-steel-500">Unidades recibidas</dt><dd className="font-display text-3xl font-bold tabular">{totalUnits}</dd></div>
              <div className="p-4"><dt className="text-xs text-steel-500">Última entrega</dt><dd className="mt-1 font-display text-lg font-bold">{formatDate(lastDate)}</dd></div>
            </dl>
          </Panel>
          <Panel title="Resumen por EPP">
            {byProduct.size === 0 ? (
              <p className="px-4 py-6 text-sm text-steel-500">Sin entregas registradas.</p>
            ) : (
              <ul className="divide-y divide-steel-100">
                {[...byProduct.values()].map((p) => (
                  <li key={`${p.name}${p.size}`} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                    <div>
                      <p className="font-medium">{p.name}{p.size && <span className="text-steel-500"> · {p.size}</span>}</p>
                      <p className="text-xs text-steel-500">Última: {formatDate(p.last)}</p>
                    </div>
                    <span className="font-display text-lg font-bold tabular">{p.qty}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </aside>
      </div>
    </>
  );
}
