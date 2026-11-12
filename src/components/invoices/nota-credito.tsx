"use client";

import { FileMinus2, FileText } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { formatDate, formatMoney } from "@/lib/utils";

/**
 * Ver la nota de crédito de una factura sin entrar en ella: el número, la fecha, el
 * importe y sus archivos, con el PDF a un clic.
 */
export function VerNotaCreditoModal({ factura, nota, archivos }: {
  factura: { id: string; label: string; currency: string };
  nota: { numero: string; fecha: string | null; importe: string | null };
  archivos: { id: string; filename: string }[];
}) {
  const [abierto, setAbierto] = useState(false);
  const pdf = archivos.find((a) => a.filename.toLowerCase().endsWith(".pdf")) ?? archivos[0];
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setAbierto(true)}
        title={`Ver la nota de crédito ${nota.numero}`}
        aria-label={`Ver la nota de crédito de ${factura.label}`}
      >
        <FileMinus2 className="h-4 w-4" /> Ver NC
      </Button>
      <Modal
        open={abierto}
        onClose={() => setAbierto(false)}
        title={`Nota de crédito ${nota.numero}`}
        description={`Anula la factura ${factura.label}.`}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setAbierto(false)}>Cerrar</Button>
            {pdf && (
              <a
                href={`/api/facturas/adjuntos/${pdf.id}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-md bg-brand px-3.5 py-2 text-sm font-semibold text-ink hover:brightness-95"
              >
                <FileText className="h-4 w-4" /> Abrir {pdf.filename.toLowerCase().endsWith(".pdf") ? "el PDF" : "el archivo"}
              </a>
            )}
          </>
        }
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md border border-steel-200 bg-steel-50 p-3 text-sm">
          <dt className="text-steel-500">Número</dt><dd className="font-semibold tabular">{nota.numero}</dd>
          <dt className="text-steel-500">Fecha</dt><dd className="tabular">{nota.fecha ? formatDate(nota.fecha) : "—"}</dd>
          <dt className="text-steel-500">Importe</dt>
          <dd className="font-display text-base font-bold tabular">{nota.importe ? formatMoney(nota.importe, factura.currency) : "—"}</dd>
        </dl>
        {archivos.length > 0 ? (
          <ul className="mt-3 grid gap-1.5 text-sm">
            {archivos.map((a) => (
              <li key={a.id}>
                <a href={`/api/facturas/adjuntos/${a.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 hover:underline">
                  <FileText className="h-4 w-4 text-steel-500" aria-hidden /> {a.filename}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-steel-600">
            La nota se anotó sin archivo. Si tienes el PDF, súbelo en la{" "}
            <Link href={`/facturas/${factura.id}`} className="underline">ficha de la factura</Link>.
          </p>
        )}
      </Modal>
    </>
  );
}
