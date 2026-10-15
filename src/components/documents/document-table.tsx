import { FileText, Paperclip } from "lucide-react";
import Link from "next/link";
import { DeleteDocumentButton, EditDocumentModal } from "@/components/documents/document-actions";
import { Badge } from "@/components/ui/badge";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import {
  cn, daysToExpiry, DOCUMENT_KIND_LABEL, documentStatus, formatDate, formatFileSize,
  type DocumentStatus,
} from "@/lib/utils";
import type { DocumentRowBase } from "@/server/document-queries";

/**
 * La tabla de documentos.
 *
 * Se colorea igual que los préstamos, por la misma razón: lo que importa es ver de un
 * vistazo qué está vencido y qué está por vencer, no leer fecha por fecha. Un SOAT
 * vencido es una multa y un seguro que no responde.
 */

const TONO: Record<DocumentStatus, string> = {
  VENCIDO: "bg-red-100/70 hover:bg-red-100",
  POR_VENCER: "bg-brand-soft hover:bg-[#FFEBA8]",
  VIGENTE: "",
  SIN_FECHA: "",
};

export function VencimientoBadge({ expiresAt }: { expiresAt: string | null }) {
  const estado = documentStatus(expiresAt);
  const dias = daysToExpiry(expiresAt);

  if (estado === "SIN_FECHA") return <span className="text-sm text-steel-400">No caduca</span>;
  return (
    <>
      <span className={cn(
        "whitespace-nowrap tabular",
        estado === "VENCIDO" && "font-semibold text-red-700",
        estado === "POR_VENCER" && "font-semibold text-[#7A5A00]",
      )}>
        {formatDate(expiresAt)}
      </span>
      {dias !== null && (
        <p className={cn(
          "text-xs",
          estado === "VENCIDO" ? "font-semibold text-red-700" : estado === "POR_VENCER" ? "text-[#7A5A00]" : "text-steel-500",
        )}>
          {estado === "VENCIDO"
            ? `venció hace ${Math.abs(dias)} día(s)`
            : dias === 0 ? "vence hoy" : `en ${dias} día(s)`}
        </p>
      )}
    </>
  );
}

export function DocumentTable({ rows, canManage, mostrarDuenio = false }: {
  rows: DocumentRowBase[];
  canManage: boolean;
  /** En la pantalla general hace falta saber de quién es cada documento; en una ficha no. */
  mostrarDuenio?: boolean;
}) {
  const columnas = mostrarDuenio ? 6 : 5;

  return (
    <TableShell>
      <thead>
        <tr>
          <Th>Documento</Th>
          {mostrarDuenio && <Th>De</Th>}
          <Th className="hidden lg:table-cell">Emitido</Th>
          <Th>Vence</Th>
          <Th className="hidden text-right lg:table-cell">Archivo</Th>
          <Th className="text-right">Acciones</Th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <EmptyRow
            colSpan={columnas}
            title="No hay documentos todavía"
            hint={canManage ? "Súbelos con el botón de arriba: el PDF del escáner o una foto del celular." : undefined}
          />
        )}
        {rows.map((d) => (
          <Tr key={d.id} tone={TONO[documentStatus(d.expiresAt)]}>
            <Td>
              <span className="flex items-start gap-2">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-steel-400" aria-hidden />
                <span className="min-w-0">
                  <Link
                    href={`/api/documentos/${d.id}`}
                    target="_blank"
                    className="font-semibold hover:underline"
                  >
                    {DOCUMENT_KIND_LABEL[d.kind] ?? d.kind}
                  </Link>
                  {d.title && <p className="text-xs text-steel-500">{d.title}</p>}
                </span>
              </span>
            </Td>
            {mostrarDuenio && (
              <Td>
                {d.plate ? (
                  <Link href={`/documentos/vehiculos/${d.vehicleId}`} className="font-medium hover:underline">{d.plate}</Link>
                ) : (
                  <>
                    <Link href={`/trabajadores/${d.employeeId}`} className="font-medium hover:underline">{d.employeeName}</Link>
                    {d.employeeDni && <p className="text-xs text-steel-500">DNI {d.employeeDni}</p>}
                  </>
                )}
              </Td>
            )}
            <Td className="hidden whitespace-nowrap tabular text-steel-600 lg:table-cell">
              {d.issuedAt ? formatDate(d.issuedAt) : "—"}
            </Td>
            <Td><VencimientoBadge expiresAt={d.expiresAt} /></Td>
            <Td className="hidden text-right text-xs text-steel-500 lg:table-cell">
              <span className="flex items-center justify-end gap-1">
                <Paperclip className="h-3 w-3" aria-hidden />
                {formatFileSize(d.sizeBytes)}
              </span>
            </Td>
            <Td>
              <div className="flex items-center justify-end gap-1">
                <Link
                  href={`/api/documentos/${d.id}`}
                  target="_blank"
                  className="rounded-md px-2.5 py-1.5 text-sm font-medium text-steel-600 hover:bg-steel-100 hover:text-ink"
                >
                  Ver
                </Link>
                {canManage && (
                  <>
                    <EditDocumentModal
                      documento={{
                        id: d.id, kind: d.kind, title: d.title, issuedAt: d.issuedAt,
                        expiresAt: d.expiresAt, notes: d.notes, filename: d.filename,
                      }}
                      esVehiculo={!!d.vehicleId}
                    />
                    <DeleteDocumentButton id={d.id} filename={d.filename} />
                  </>
                )}
              </div>
            </Td>
          </Tr>
        ))}
      </tbody>
    </TableShell>
  );
}

/** La leyenda de colores, la misma idea que en préstamos. */
export function LeyendaVencimientos() {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-steel-500">
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-3 rounded-sm border border-red-300 bg-red-100/70" aria-hidden /> Vencido
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-3 rounded-sm border border-brand bg-brand-soft" aria-hidden /> Vence dentro de 30 días
      </span>
    </div>
  );
}

export function EstadoBadge({ expiresAt }: { expiresAt: string | null }) {
  const estado = documentStatus(expiresAt);
  if (estado === "VENCIDO") return <Badge tone="red">Vencido</Badge>;
  if (estado === "POR_VENCER") return <Badge tone="yellow">Por vencer</Badge>;
  if (estado === "SIN_FECHA") return <Badge tone="neutral">No caduca</Badge>;
  return <Badge tone="green">Vigente</Badge>;
}
