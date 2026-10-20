import { Car, FileDown, IdCard, MapPin, Minus, UserRound } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import {
  anioPrimeraRevision, cn, daysToExpiry, documentStatus, exigeRevisionTecnica, formatDate,
} from "@/lib/utils";
import { estadoFlota, type FleetRow, type PapelResumen } from "@/server/document-queries";

/**
 * La flota con sus papeles en columnas, una fila por placa.
 *
 * La pregunta que resuelve es una sola: ¿esta unidad puede salir hoy? Por eso cada papel
 * clave tiene su propia columna con la fecha a la vista y el botón al PDF al lado, y por
 * eso lo que falta se pinta igual de fuerte que lo vencido: a la hora de un control en la
 * carretera dan lo mismo.
 */

const TONO: Record<ReturnType<typeof estadoFlota>, string> = {
  VENCIDO: "bg-red-100/70 hover:bg-red-100",
  FALTA: "bg-red-50 hover:bg-red-100/70",
  POR_VENCER: "bg-brand-soft hover:bg-[#FFEBA8]",
  AL_DIA: "",
  BAJA: "opacity-60",
};

function EstadoFlotaBadge({ estado }: { estado: ReturnType<typeof estadoFlota> }) {
  if (estado === "BAJA") return <Badge tone="neutral">De baja</Badge>;
  if (estado === "VENCIDO") return <Badge tone="red">Vencido</Badge>;
  if (estado === "FALTA") return <Badge tone="red">Falta un papel</Badge>;
  if (estado === "POR_VENCER") return <Badge tone="yellow">Por vencer</Badge>;
  return <Badge tone="green">Puede salir</Badge>;
}

/**
 * Una celda de papel: la fecha, el color según cuánto le queda, y el botón al PDF.
 *
 * El botón solo aparece si el archivo está cargado. Un enlace que lleva a un error es peor
 * que no tener enlace: hace perder el viaje a quien lo pulsa creyendo que el papel está.
 */
export function PapelCell({ papel, nombre, noLeTocaHasta }: {
  papel: PapelResumen;
  nombre: string;
  /**
   * Año desde el que recién se le exige este papel, si todavía no le toca.
   *
   * Es el caso de la revisión técnica en una unidad nueva: que falte no es un problema,
   * y pintarlo de rojo junto a lo que sí lo es hace que se dejen de mirar los rojos.
   */
  noLeTocaHasta?: number | null;
}) {
  if (!papel) {
    if (noLeTocaHasta) {
      return (
        <Td className="whitespace-nowrap">
          <span className="text-sm text-steel-500">No le toca</span>
          <p className="text-xs text-steel-400">desde {noLeTocaHasta}</p>
        </Td>
      );
    }
    return (
      <Td className="whitespace-nowrap">
        <span className="inline-flex items-center gap-1 text-sm font-semibold text-red-700">
          <Minus className="h-3.5 w-3.5" aria-hidden /> Falta
        </span>
      </Td>
    );
  }

  const estado = documentStatus(papel.expiresAt);
  const dias = daysToExpiry(papel.expiresAt);

  return (
    <Td className="whitespace-nowrap">
      <span className="flex items-center gap-1.5">
        <span>
          <span className={cn(
            "tabular",
            estado === "VENCIDO" && "font-semibold text-red-700",
            estado === "POR_VENCER" && "font-semibold text-[#7A5A00]",
            estado === "SIN_FECHA" && "text-steel-500",
          )}>
            {papel.expiresAt ? formatDate(papel.expiresAt) : "Sin fecha"}
          </span>
          {dias !== null && estado !== "VIGENTE" && (
            <p className={cn(
              "text-xs",
              estado === "VENCIDO" ? "font-semibold text-red-700" : "text-[#7A5A00]",
            )}>
              {estado === "VENCIDO"
                ? `venció hace ${Math.abs(dias)} d.`
                : dias === 0 ? "vence hoy" : `en ${dias} d.`}
            </p>
          )}
          {!papel.tieneArchivo && <p className="text-xs text-amber-700">falta el PDF</p>}
        </span>
        {papel.tieneArchivo && (
          <Link
            href={`/api/documentos/${papel.id}`}
            target="_blank"
            title={`Abrir el ${nombre}`}
            className="rounded p-1 text-steel-400 hover:bg-steel-100 hover:text-ink"
          >
            <FileDown className="h-4 w-4" aria-hidden />
            <span className="sr-only">Abrir el {nombre}</span>
          </Link>
        )}
      </span>
    </Td>
  );
}

export function FleetTable({ rows }: { rows: FleetRow[] }) {
  return (
    <TableShell>
      <thead>
        <tr>
          <Th>Unidad</Th>
          <Th>SOAT</Th>
          <Th>Revisión técnica</Th>
          <Th>MTC</Th>
          <Th>Tarjeta de propiedad</Th>
          <Th className="hidden lg:table-cell">Conductor</Th>
          <Th>Estado</Th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <EmptyRow
            colSpan={7}
            title="No hay vehículos que coincidan"
            hint="Prueba quitando los filtros, o registra la unidad con el botón de arriba."
          />
        )}
        {rows.map((v) => {
          const estado = estadoFlota(v);
          return (
            <Tr key={v.id} tone={TONO[estado]}>
              <Td>
                <Link href={`/documentos/vehiculos/${v.id}`} className="flex items-start gap-2">
                  <Car className="mt-0.5 h-4 w-4 shrink-0 text-steel-400" aria-hidden />
                  <span>
                    <span className="font-semibold hover:underline">{v.plate}</span>
                    <p className="text-xs text-steel-500">
                      {[v.brand, v.model, v.year].filter(Boolean).join(" ") || v.description || "—"}
                    </p>
                    {(v.capacityTn || v.hasGps) && (
                      <p className="text-xs text-steel-400">
                        {v.capacityTn ? `${Number(v.capacityTn)} TN` : null}
                        {v.capacityTn && v.hasGps ? " · " : null}
                        {v.hasGps ? <span className="inline-flex items-center gap-0.5"><MapPin className="h-3 w-3" aria-hidden />GPS</span> : null}
                      </p>
                    )}
                  </span>
                </Link>
              </Td>
              <PapelCell papel={v.soat} nombre="SOAT" />
              <PapelCell
                papel={v.revisionTecnica}
                nombre="certificado de revisión técnica"
                noLeTocaHasta={exigeRevisionTecnica(v.year) ? null : anioPrimeraRevision(v.year)}
              />
              <PapelCell papel={v.mtc} nombre="certificado de habilitación MTC" />
              <PapelCell papel={v.tarjetaPropiedad} nombre="tarjeta de propiedad" />
              <Td className="hidden lg:table-cell">
                {v.driverId && v.driverName ? (
                  <span className="flex items-start gap-2">
                    <UserRound className="mt-0.5 h-4 w-4 shrink-0 text-steel-400" aria-hidden />
                    <span className="min-w-0">
                      <Link href={`/trabajadores/${v.driverId}`} className="font-medium hover:underline">
                        {v.driverName}
                      </Link>
                      <p className="flex flex-wrap items-center gap-x-2 text-xs text-steel-500">
                        <PapelConductor papel={v.dniConductor} nombre="DNI" />
                        <PapelConductor papel={v.licencia} nombre="Licencia" />
                      </p>
                    </span>
                  </span>
                ) : (
                  <span className="text-sm text-amber-700">Sin conductor asignado</span>
                )}
              </Td>
              <Td><EstadoFlotaBadge estado={estado} /></Td>
            </Tr>
          );
        })}
      </tbody>
    </TableShell>
  );
}

/** El DNI o la licencia del conductor, en chico: su nombre, su estado y el enlace al PDF. */
function PapelConductor({ papel, nombre }: { papel: PapelResumen; nombre: string }) {
  if (!papel) return <span className="text-amber-700">{nombre}: falta</span>;
  const estado = documentStatus(papel.expiresAt);
  const texto = papel.expiresAt ? formatDate(papel.expiresAt) : "cargado";

  const etiqueta = (
    <span className={cn(
      "inline-flex items-center gap-0.5",
      estado === "VENCIDO" && "font-semibold text-red-700",
      estado === "POR_VENCER" && "font-semibold text-[#7A5A00]",
    )}>
      <IdCard className="h-3 w-3" aria-hidden />
      {nombre}: {texto}
    </span>
  );

  if (!papel.tieneArchivo) return etiqueta;
  return (
    <Link href={`/api/documentos/${papel.id}`} target="_blank" className="hover:underline" title={`Abrir el ${nombre} del conductor`}>
      {etiqueta}
    </Link>
  );
}

/** La leyenda de la tabla de flota. */
export function LeyendaFlota() {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-steel-500">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-3 rounded-sm border border-red-300 bg-red-100/70" aria-hidden /> Vencido o sin cargar
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-3 rounded-sm border border-brand bg-brand-soft" aria-hidden /> Vence dentro de 30 días
      </span>
      <span>El botón junto a cada fecha abre el PDF del documento.</span>
    </div>
  );
}
