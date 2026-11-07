import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { RenameDestinationModal, UnifyAllDestinationsButton } from "@/components/invoices/destination-actions";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { destinationVariants } from "@/server/invoice-queries";

export const metadata: Metadata = { title: "Limpiar destinos" };

/**
 * Los destinos de las facturas, uno por fila, con cada manera en que está escrito.
 *
 * Arriba van los que están escritos de varias maneras —lo que hay que limpiar—, con un
 * botón para unificarlos todos de una vez. Cualquier destino se puede renombrar, o juntar
 * con otro escribiendo el nombre de ese.
 */
export default async function DestinosPage() {
  await requirePageUser("invoices.manage");
  const grupos = await destinationVariants();
  const repetidos = grupos.filter((g) => g.variantes.length > 1);
  const ordenados = [...repetidos, ...grupos.filter((g) => g.variantes.length === 1)];
  const todos = grupos.map((g) => g.variantes[0].name);
  const facturasACorregir = repetidos.reduce(
    (n, g) => n + g.variantes.slice(1).reduce((m, v) => m + v.facturas, 0), 0);

  return (
    <>
      <Link href="/facturas" className="mb-4 inline-flex items-center gap-1.5 text-sm text-steel-500 hover:text-ink">
        <ArrowLeft className="h-4 w-4" /> Volver a facturas
      </Link>
      <PageHeader
        title="Limpiar destinos"
        description="El destino se escribe a mano en cada factura. Aquí se junta lo que es el mismo destino escrito de otra manera."
        actions={repetidos.length > 0 ? <UnifyAllDestinationsButton grupos={repetidos.length} facturas={facturasACorregir} /> : undefined}
      />

      <p className={cn(
        "mb-4 rounded-lg border px-4 py-3 text-sm",
        repetidos.length > 0 ? "border-amber-300 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-800",
      )}>
        {repetidos.length > 0
          ? `${repetidos.length} destino(s) están escritos de varias maneras: van primero. "Unificar todos" deja cada uno con la escritura más usada.`
          : "Ningún destino está escrito de varias maneras. Si dos destinos distintos son el mismo lugar, renombra uno con el nombre del otro."}
        {" "}Desde ahora, al registrar una factura el destino toma solo la escritura que ya existe.
      </p>

      <TableShell>
        <thead>
          <tr>
            <Th>Destino</Th>
            <Th>Cómo está escrito</Th>
            <Th className="text-right">Facturas</Th>
            <Th className="text-right">Acciones</Th>
          </tr>
        </thead>
        <tbody>
          {ordenados.length === 0 && <EmptyRow colSpan={4} title="Ninguna factura tiene destino todavía" />}
          {ordenados.map((g) => (
            <Tr key={g.clave} tone={g.variantes.length > 1 ? "bg-amber-50/60" : ""}>
              <Td className="font-semibold">
                <Link href={`/facturas?destino=${encodeURIComponent(g.variantes[0].name)}`} className="hover:underline">
                  {g.variantes[0].name}
                </Link>
              </Td>
              <Td>
                <div className="flex flex-wrap gap-1.5">
                  {g.variantes.map((v) => (
                    <span key={v.name} className="rounded border border-steel-200 bg-white px-2 py-0.5 text-xs text-steel-700">
                      <span className="whitespace-pre">&ldquo;{v.name}&rdquo;</span>{" "}
                      <span className="text-steel-400">· {v.facturas}</span>
                    </span>
                  ))}
                </div>
              </Td>
              <Td className="text-right tabular">{g.facturas}</Td>
              <Td>
                <div className="flex justify-end">
                  <RenameDestinationModal variantes={g.variantes} todos={todos} />
                </div>
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>
    </>
  );
}
