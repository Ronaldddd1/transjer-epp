import { ClipboardList, Truck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { DateJump } from "@/components/attendance/date-jump";
import {
  DeleteTripButton, SettleTripButton, TripFormModal, UnsettleTripButton, type TripOptions,
} from "@/components/trips/trip-actions";
import { ExportTable } from "@/components/ui/export-table";
import { FilterBar } from "@/components/ui/filter-bar";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { cn, formatDate, todayLima, TRIP_DOC_LABEL, type SearchParams } from "@/lib/utils";
import {
  listTripsControl, listTripsDay, readTripFilters, tripClientOptions, tripDriverOptions,
  tripPendingSummary, tripVehicleOptions, type TripRow,
} from "@/server/trip-queries";

export const metadata: Metadata = { title: "Salidas y liquidación" };

/**
 * Las salidas diarias de la flota y el control de su liquidación.
 *
 * Dos botones arriba, uno por cada trabajo: anotar lo que salió hoy (qué unidad, para qué
 * cliente y con qué documento: el FO en Alicorp, la guía o la orden en los demás), y el
 * control de qué documentos faltan liquidar, lo más antiguo primero.
 */
export default async function SalidasPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePageUser("trips.view");
  const sp = await searchParams;
  const f = readTripFilters(sp);
  const puedeEditar = can(user, "trips.manage");

  const [vehiculos, conductores, clientes, pendientes, filas] = await Promise.all([
    tripVehicleOptions(),
    tripDriverOptions(),
    tripClientOptions(),
    tripPendingSummary(),
    f.vista === "dia" ? listTripsDay(f.dia, f.q) : listTripsControl(f),
  ]);
  const opciones: TripOptions = { vehiculos, conductores, clientes };
  const hoy = todayLima();

  return (
    <>
      <PageHeader
        title="Salidas y liquidación"
        description="Qué unidad salió cada día, para qué cliente y con qué documento, y si ese documento ya se liquidó."
        actions={
          <>
            {puedeEditar && <TripFormModal opciones={opciones} dia={f.dia} />}
            <ExportTable tabla="salidas" label="Descargar" extra={f.vista === "dia" ? { dia: f.dia } : undefined} />
          </>
        }
      />

      <nav aria-label="Vistas de salidas" className="mb-5 grid gap-3 sm:grid-cols-2">
        {([
          { v: "dia", href: "/salidas", titulo: "Salidas del día", texto: "Registrar y ver lo que salió cada día.", icono: Truck },
          {
            v: "control", href: "/salidas?vista=control", titulo: "Control de liquidación",
            texto: pendientes.total === 0 ? "Todo liquidado." : `${pendientes.total} documento(s) por liquidar.`,
            icono: ClipboardList,
          },
        ] as const).map(({ v, href, titulo, texto, icono: Icono }) => (
          <Link
            key={v}
            href={href}
            aria-current={f.vista === v ? "page" : undefined}
            className={f.vista === v
              ? "flex items-center gap-3 rounded-lg border-2 border-ink bg-ink px-4 py-3 text-white"
              : "flex items-center gap-3 rounded-lg border-2 border-steel-200 bg-white px-4 py-3 text-ink hover:border-ink"}
          >
            <Icono className={f.vista === v ? "h-6 w-6 text-brand" : "h-6 w-6 text-steel-500"} aria-hidden />
            <span>
              <span className="block font-display text-base font-semibold">{titulo}</span>
              <span className={f.vista === v ? "block text-sm text-steel-300" : "block text-sm text-steel-500"}>{texto}</span>
            </span>
          </Link>
        ))}
      </nav>

      {f.vista === "dia" ? (
        <>
          <DateJump dia={f.dia} hoy={hoy} ruta="/salidas" leyenda="Salidas del" />
          <TablaSalidas filas={filas} opciones={opciones} puedeEditar={puedeEditar} conFecha={false} />
          {filas.length > 0 && (
            <p className="mt-3 text-sm text-steel-500">
              {filas.length} salida(s) el {formatDate(f.dia)} ·{" "}
              {filas.filter((r) => r.status === "PENDIENTE").length} por liquidar.
            </p>
          )}
        </>
      ) : (
        <>
          {pendientes.porCliente.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {pendientes.porCliente.map((c) => (
                <Link
                  key={c.client}
                  href={`/salidas?vista=control&estado=PENDIENTE&q=${encodeURIComponent(c.client)}`}
                  className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 hover:border-amber-400"
                  title={`El más antiguo es del ${formatDate(c.masAntigua)}`}
                >
                  <strong>{c.client}</strong>: {c.pendientes} por liquidar
                </Link>
              ))}
            </div>
          )}
          <FilterBar
            searchPlaceholder="Cliente, N° de documento, placa o destino"
            filters={[
              {
                type: "select", name: "estado", label: "Estado", allLabel: "Todas",
                options: [{ value: "PENDIENTE", label: "Por liquidar" }, { value: "LIQUIDADO", label: "Liquidadas" }],
              },
              { type: "date", name: "desde", label: "Salida desde" },
              { type: "date", name: "hasta", label: "Hasta" },
            ]}
          />
          <TablaSalidas filas={filas} opciones={opciones} puedeEditar={puedeEditar} conFecha />
        </>
      )}
    </>
  );
}

function TablaSalidas({ filas, opciones, puedeEditar, conFecha }: {
  filas: TripRow[]; opciones: TripOptions; puedeEditar: boolean; conFecha: boolean;
}) {
  return (
    <TableShell>
      <thead>
        <tr>
          {conFecha && <Th>Salida</Th>}
          <Th>Unidad</Th>
          <Th>Cliente y destino</Th>
          <Th>Documento</Th>
          <Th>Liquidación</Th>
          <Th className="text-right">Acciones</Th>
        </tr>
      </thead>
      <tbody>
        {filas.length === 0 && (
          <EmptyRow colSpan={conFecha ? 6 : 5} title={conFecha ? "No hay salidas con esos filtros" : "No se registraron salidas este día"} />
        )}
        {filas.map((r) => {
          const documento = `${TRIP_DOC_LABEL[r.docType] ?? r.docType} ${r.docNumber}`;
          const pendiente = r.status === "PENDIENTE";
          return (
            <Tr key={r.id}>
              {conFecha && <Td className="whitespace-nowrap tabular">{formatDate(r.day)}</Td>}
              <Td>
                <span className="font-semibold">{r.plate}</span>
                <p className="text-xs text-steel-500">{r.driverName ?? "sin conductor"}</p>
              </Td>
              <Td>
                {r.client}
                {r.destination && <p className="text-xs text-steel-500">{r.destination}</p>}
              </Td>
              <Td>
                <span className="text-xs text-steel-500">{TRIP_DOC_LABEL[r.docType] ?? r.docType}</span>
                <p className="font-semibold tabular">{r.docNumber}</p>
              </Td>
              <Td>
                {pendiente ? (
                  <span className={cn(
                    "inline-block rounded px-2 py-0.5 text-xs font-semibold",
                    r.dias > 15 ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-900",
                  )}>
                    Por liquidar{r.dias > 0 ? ` · ${r.dias} d` : ""}
                  </span>
                ) : (
                  <>
                    <span className="inline-block rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">Liquidado</span>
                    <p className="text-xs text-steel-500">
                      el {formatDate(r.settledAt!)}{r.settledByName ? ` · ${r.settledByName}` : ""}
                    </p>
                  </>
                )}
              </Td>
              <Td>
                {puedeEditar && (
                  <div className="flex items-center justify-end gap-1">
                    {pendiente ? (
                      <>
                        <SettleTripButton id={r.id} documento={documento} dia={r.day} />
                        <TripFormModal opciones={opciones} dia={r.day} salida={{
                          id: r.id, day: r.day, vehicleId: r.vehicleId, driverId: r.driverId, client: r.client,
                          destination: r.destination, docType: r.docType, docNumber: r.docNumber, notes: r.notes,
                        }} />
                        <DeleteTripButton id={r.id} documento={documento} />
                      </>
                    ) : (
                      <UnsettleTripButton id={r.id} documento={documento} />
                    )}
                  </div>
                )}
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </TableShell>
  );
}
