import { AlertTriangle, ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DeliveryModal } from "@/components/deliveries/delivery-modal";
import { ReturnModal } from "@/components/deliveries/return-modal";
import { VoidDeliveryModal } from "@/components/deliveries/void-delivery-modal";
import { DocumentFormModal } from "@/components/documents/document-actions";
import { DocumentTable, LeyendaVencimientos } from "@/components/documents/document-table";
import { EmployeeFormModal } from "@/components/employees/employee-form-modal";
import { ReinstateButton, TerminationModal } from "@/components/employees/termination-modal";
import { EmployeeStateBadge, ReturnConditionBadge, VoidedNote } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Panel } from "@/components/ui/page-header";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { cn, documentStatus, formatDate, todayLima } from "@/lib/utils";
import { listDocumentsFor } from "@/server/document-queries";
import { attendanceFor } from "@/server/attendance-queries";
import {
  employeeHoldings, getEmployee, getEmployeeOptions, getProductOptions, listDeliveries, listReturns,
} from "@/server/queries";

export const metadata: Metadata = { title: "Historial del trabajador" };

export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser("employees.view");
  const { id } = await params;
  const employee = await getEmployee(id);
  if (!employee) notFound();

  const canDeliver = can(user.role, "deliveries.create") && employee.active;
  // Quien no tiene acceso a documentos no ve la sección, igual que no ve el menú.
  const verDocumentos = can(user.role, "documents.view");
  const verAsistencia = can(user.role, "attendance.view");
  const [{ rows }, holdings, devoluciones, products, employees, documentos, asistencia] = await Promise.all([
    listDeliveries({ employeeId: id }),
    employeeHoldings(id),
    listReturns({ employeeId: id }),
    canDeliver ? getProductOptions() : Promise.resolve([]),
    canDeliver ? getEmployeeOptions() : Promise.resolve([]),
    verDocumentos ? listDocumentsFor({ employeeId: id }) : Promise.resolve([]),
    verAsistencia ? attendanceFor(id, 60) : Promise.resolve([]),
  ]);
  const docsVencidos = documentos.filter((d) => documentStatus(d.expiresAt) === "VENCIDO");
  const canVoid = can(user.role, "deliveries.void");
  const canReturn = can(user.role, "deliveries.create");
  const canManage = can(user.role, "employees.manage");
  // Las entregas anuladas se muestran en el historial, pero no cuentan en los totales.
  const valid = rows.filter((r) => !r.voidedAt);
  const totalUnits = valid.reduce((s, r) => s + r.quantity, 0);
  const lastDate = valid[0]?.deliveryDate;

  // Lo que tiene a su cargo: entregado menos devuelto. El pendiente es lo que hay que
  // reclamarle si cesa, y se calcula, no se guarda.
  const pendientes = holdings.filter((h) => h.pendiente > 0);
  const unidadesPendientes = pendientes.reduce((s, h) => s + h.pendiente, 0);
  const itemsPendientes = pendientes.map((h) => ({
    productId: h.productId, productName: h.productName, size: h.size, unit: h.unit, pendiente: h.pendiente,
  }));
  const debeEpp = !!employee.terminatedAt && unidadesPendientes > 0;

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
              <EmployeeStateBadge active={employee.active} terminatedAt={employee.terminatedAt} pendiente={unidadesPendientes} />
            </div>
            <p className="text-steel-600">{employee.position} · {employee.area}</p>
            <p className="text-sm text-steel-500">
              DNI {employee.dni}
              {employee.phone && <> · Tel. {employee.phone}</>}
              {employee.hireDate && <> · Ingreso {formatDate(employee.hireDate)}</>}
              {employee.terminatedAt && <> · Cese {formatDate(employee.terminatedAt)}</>}
            </p>
            {employee.terminationReason && <p className="text-sm text-steel-500">Motivo del cese: {employee.terminationReason}</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canDeliver && <DeliveryModal employees={employees} products={products} today={todayLima()} userName={user.name} employeeId={employee.id} />}
          {canReturn && itemsPendientes.length > 0 && (
            <ReturnModal
              employee={{ id: employee.id, name: `${employee.firstName} ${employee.lastName}`, terminatedAt: employee.terminatedAt }}
              items={itemsPendientes}
              variant={debeEpp ? "primary" : "outline"}
            />
          )}
          {canManage && !employee.terminatedAt && (
            <TerminationModal
              employee={{ id: employee.id, name: `${employee.firstName} ${employee.lastName}`, hireDate: employee.hireDate }}
              pendiente={unidadesPendientes}
              tipos={pendientes.length}
            />
          )}
          {canManage && employee.terminatedAt && (
            <ReinstateButton employee={{ id: employee.id, name: `${employee.firstName} ${employee.lastName}`, terminatedAt: employee.terminatedAt }} />
          )}
          {canManage && <EmployeeFormModal employee={employee} />}
          {can(user.role, "reports.view") && <ButtonLink href={`/reportes?tipo=entregas&employee=${employee.id}`} variant="ghost">Exportar</ButtonLink>}
        </div>
      </div>

      {debeEpp && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <span>
            Cesó el {formatDate(employee.terminatedAt)} y todavía tiene{" "}
            <strong>{unidadesPendientes} unidad(es)</strong> de EPP a su cargo, de {pendientes.length} tipo(s).
            Registra la devolución de cada uno para cerrar su cuenta.
          </span>
        </div>
      )}

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
          {/*
            * Los datos personales, a la vista.
            *
            * El contacto de emergencia es el que nadie busca hasta que hace falta, y
            * entonces hace falta en minutos: por eso va aquí y no dentro de un formulario
            * que hay que abrir.
            */}
          <Panel title="Datos del trabajador">
            <dl className="divide-y divide-steel-100 border-t border-steel-100">
              <div className="px-4 py-2.5">
                <dt className="text-xs text-steel-500">DNI</dt>
                <dd className="text-sm font-medium tabular">{employee.dni}</dd>
              </div>
              <div className="px-4 py-2.5">
                <dt className="text-xs text-steel-500">Ingresó</dt>
                <dd className="text-sm font-medium">{employee.hireDate ? formatDate(employee.hireDate) : "—"}</dd>
              </div>
              <div className="px-4 py-2.5">
                <dt className="text-xs text-steel-500">Teléfono</dt>
                <dd className="text-sm font-medium">{employee.phone ?? "—"}</dd>
              </div>
              <div className="px-4 py-2.5">
                <dt className="text-xs text-steel-500">Dirección</dt>
                <dd className="text-sm font-medium">{employee.address ?? "—"}</dd>
              </div>
              <div className="px-4 py-2.5">
                <dt className="text-xs text-steel-500">Contacto de emergencia</dt>
                <dd className="text-sm font-medium">
                  {employee.emergencyContactName ? (
                    <>
                      {employee.emergencyContactName}
                      {employee.emergencyContactRelation && (
                        <span className="text-steel-500"> · {employee.emergencyContactRelation}</span>
                      )}
                      {employee.emergencyContactPhone && (
                        <a href={`tel:${employee.emergencyContactPhone}`} className="block text-sm text-steel-600 hover:underline">
                          {employee.emergencyContactPhone}
                        </a>
                      )}
                    </>
                  ) : (
                    <span className="text-amber-700">Sin registrar</span>
                  )}
                </dd>
              </div>
            </dl>
          </Panel>

          {asistencia.length > 0 && (
            <Panel
              title="Asistencia"
              action={
                <Link href="/asistencia" className="text-sm text-steel-500 hover:text-ink hover:underline">
                  Pasar lista
                </Link>
              }
            >
              <dl className="grid grid-cols-3 divide-x divide-steel-200 border-t border-steel-100">
                <div className="p-3 text-center">
                  <dt className="text-xs text-steel-500">Vino</dt>
                  <dd className="font-display text-2xl font-bold tabular text-emerald-700">
                    {asistencia.filter((a) => a.status === "PRESENTE").length}
                  </dd>
                </div>
                <div className="p-3 text-center">
                  <dt className="text-xs text-steel-500">Faltó</dt>
                  <dd className="font-display text-2xl font-bold tabular text-red-700">
                    {asistencia.filter((a) => a.status === "FALTA").length}
                  </dd>
                </div>
                <div className="p-3 text-center">
                  <dt className="text-xs text-steel-500">Justificado</dt>
                  <dd className="font-display text-2xl font-bold tabular text-[#7A5A00]">
                    {asistencia.filter((a) => a.status === "JUSTIFICADO").length}
                  </dd>
                </div>
              </dl>
              <ul className="divide-y divide-steel-100 border-t border-steel-100">
                {asistencia.slice(0, 8).map((a) => (
                  <li key={a.day} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                    <span className="tabular text-steel-600">{formatDate(a.day)}</span>
                    <span className={cn(
                      "text-sm",
                      a.status === "FALTA" && "font-semibold text-red-700",
                      a.status === "JUSTIFICADO" && "text-[#7A5A00]",
                      a.status === "PRESENTE" && "text-emerald-700",
                    )}>
                      {a.status === "PRESENTE" ? "Vino" : a.status === "FALTA" ? "Faltó" : "Justificado"}
                      {a.activity && <span className="block text-xs text-steel-500">{a.activity}</span>}
                      {a.reason && <span className="block text-xs text-steel-500">{a.reason}</span>}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="border-t border-steel-100 px-4 py-2 text-xs text-steel-500">
                Lo registrado en los últimos días. Los días sin registrar no cuentan.
              </p>
            </Panel>
          )}

          <Panel>
            <dl className="grid grid-cols-2 divide-x divide-steel-200">
              <div className="p-4"><dt className="text-xs text-steel-500">Unidades recibidas</dt><dd className="font-display text-3xl font-bold tabular">{totalUnits}</dd></div>
              <div className="p-4">
                <dt className="text-xs text-steel-500">A su cargo</dt>
                <dd className={cn("font-display text-3xl font-bold tabular", debeEpp && "text-red-700")}>{unidadesPendientes}</dd>
              </div>
            </dl>
            <p className="border-t border-steel-200 px-4 py-2 text-xs text-steel-500">
              Última entrega: {formatDate(lastDate)}
            </p>
          </Panel>

          {/* Lo que tiene hoy, no lo que recibió alguna vez: lo devuelto ya no figura
              pendiente, y es esta columna la que se le reclama al cesar. */}
          <Panel title="EPP a su cargo" action={<span className="text-sm text-steel-500">{holdings.length} tipo(s)</span>}>
            {holdings.length === 0 ? (
              <p className="px-4 py-6 text-sm text-steel-500">Sin entregas registradas.</p>
            ) : (
              <ul className="divide-y divide-steel-100">
                {holdings.map((h) => (
                  <li key={h.productId} className="px-4 py-2.5 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">{h.productName}{h.size && <span className="text-steel-500"> · {h.size}</span>}</p>
                        <p className="text-xs text-steel-500">
                          Entregado {h.entregado}
                          {h.devuelto > 0 && <> · devuelto {h.devuelto}</>}
                          {" · "}última {formatDate(h.ultima)}
                        </p>
                      </div>
                      <span className={cn("font-display text-lg font-bold tabular", h.pendiente > 0 ? debeEpp && "text-red-700" : "text-steel-400")}>
                        {h.pendiente}
                      </span>
                    </div>
                    {h.pendiente > 0 && canReturn && (
                      <div className="mt-1.5">
                        <ReturnModal
                          employee={{ id: employee.id, name: `${employee.firstName} ${employee.lastName}`, terminatedAt: employee.terminatedAt }}
                          items={itemsPendientes}
                          productId={h.productId}
                          variant="ghost"
                          compact
                        />
                      </div>
                    )}
                    {h.pendiente === 0 && (
                      <p className="mt-0.5 text-xs text-emerald-700">
                        Saldado{h.noDevuelto > 0 && ` · ${h.noDevuelto} no devuelto(s)`}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {devoluciones.rows.length > 0 && (
            <Panel title="Devoluciones" action={<span className="text-sm text-steel-500">{devoluciones.total}</span>}>
              <ul className="divide-y divide-steel-100">
                {devoluciones.rows.map((d) => (
                  <li key={d.id} className="px-4 py-2.5 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">{d.productName}{d.size && <span className="text-steel-500"> · {d.size}</span>}</p>
                        <p className="text-xs text-steel-500">{formatDate(d.returnDate)} · {d.reason} · {d.userName}</p>
                        {d.notes && <p className="text-xs text-steel-500">{d.notes}</p>}
                      </div>
                      <div className="shrink-0 text-right">
                        <span className="font-display text-lg font-bold tabular">{d.quantity}</span>
                        <p className="mt-0.5"><ReturnConditionBadge condition={d.condition} /></p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </aside>
      </div>

      {/* Sus papeles: licencia, SCTR, examen médico. Van aquí y no en una pantalla aparte
          porque es donde se los busca —"¿cuándo le vence la licencia a este?"— y porque
          así el mismo lugar responde qué tiene a su cargo y qué documentos le faltan. */}
      {verDocumentos && (
        <section className="mt-8">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-semibold">Documentos</h2>
              <p className="text-sm text-steel-500">
                {documentos.length === 0
                  ? "Todavía no tiene ninguno cargado."
                  : `${documentos.length} documento(s)${docsVencidos.length > 0 ? ` · ${docsVencidos.length} vencido(s)` : ""}`}
              </p>
            </div>
            {can(user.role, "documents.manage") && (
              <DocumentFormModal
                employeeId={employee.id}
                etiqueta={`${employee.firstName} ${employee.lastName}`}
              />
            )}
          </div>

          {docsVencidos.length > 0 && (
            <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              Tiene {docsVencidos.length} documento(s) vencido(s):{" "}
              {docsVencidos.map((d) => `${d.title ?? d.kind} (venció el ${formatDate(d.expiresAt)})`).join(", ")}.
            </p>
          )}

          <LeyendaVencimientos />
          <DocumentTable rows={documentos} canManage={can(user.role, "documents.manage")} />
        </section>
      )}
    </>
  );
}
