import { Route } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { NuevaProgramacion } from "@/components/rutas/nueva-programacion";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { requirePageUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { formatDate, formatDateTime, formatNumber } from "@/lib/utils";
import { listarPlanes } from "@/server/rutas";

export const metadata: Metadata = { title: "Rutas de reparto" };
export const dynamic = "force-dynamic";

/**
 * Las rutas de reparto: cada programación que manda el cliente (un Excel por día) y las
 * rutas que salieron de ella.
 */
export default async function RutasPage() {
  const user = await requirePageUser("trips.view");
  const planes = await listarPlanes();
  const canManage = can(user, "trips.manage");

  return (
    <>
      <PageHeader
        title="Rutas de reparto"
        description="Sube la programación del cliente y el sistema arma la ruta más corta para cada móvil: sale de la cochera, carga en el centro de Lurín, hace sus entregas y vuelve a la cochera."
        actions={canManage ? <NuevaProgramacion /> : undefined}
      />
      <TableShell>
        <thead>
          <tr>
            <Th>Día del reparto</Th>
            <Th>Archivo</Th>
            <Th className="text-right">Paradas</Th>
            <Th className="text-right">Peso</Th>
            <Th className="text-right">Móviles</Th>
            <Th className="text-right">Km totales</Th>
            <Th>Estado</Th>
          </tr>
        </thead>
        <tbody>
          {planes.length === 0 && (
            <EmptyRow colSpan={7} title="Todavía no hay programaciones" hint="Sube el Excel que manda el cliente con «Nueva programación»." />
          )}
          {planes.map((p) => (
            <Tr key={p.id}>
              <Td>
                <Link href={`/rutas/${p.id}`} className="font-semibold text-ink hover:underline">{formatDate(p.serviceDate)}</Link>
                <p className="text-xs text-steel-500">Cargada el {formatDateTime(p.createdAt)}</p>
              </Td>
              <Td className="max-w-xs truncate text-steel-600">{p.fileName ?? "—"}</Td>
              <Td className="text-right tabular">{p.paradas}</Td>
              <Td className="text-right tabular">{formatNumber(Math.round(Number(p.kg)))} kg</Td>
              <Td className="text-right tabular">{p.moviles || "—"}</Td>
              <Td className="text-right tabular font-semibold">{p.totalKm ? `${Number(p.totalKm).toFixed(1)} km` : "—"}</Td>
              <Td>
                {p.status === "CALCULADA"
                  ? <Badge tone="green"><Route className="h-3 w-3" /> Rutas listas{p.approximate ? " (aprox.)" : ""}</Badge>
                  : <Badge tone="yellow">Por calcular</Badge>}
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>
    </>
  );
}
