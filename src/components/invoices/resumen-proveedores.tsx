import Link from "next/link";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { formatDate, formatMoney } from "@/lib/utils";
import type { ResumenProveedor } from "@/server/invoice-queries";

/**
 * Resumen por proveedor: en el rango de fechas elegido, cuántas facturas emitió cada uno,
 * cuánto suman, cuánto ya se pagó, cuánto se le adelantó y cuánto falta.
 *
 * Cada fila cumple: facturado = pagado + adelantos + pendiente. Desde la fila se abre la
 * lista de sus facturas con el mismo rango.
 */
export function ResumenProveedores({ filas, desde, hasta }: { filas: ResumenProveedor[]; desde?: string; hasta?: string }) {
  const monedas = Array.from(new Set(filas.map((f) => f.currency)));
  const totales = monedas.map((m) => {
    const de = filas.filter((f) => f.currency === m);
    const suma = (k: "facturado" | "pagado" | "adelantos" | "pendiente") => de.reduce((s, f) => s + Number(f[k]), 0);
    return {
      currency: m, proveedores: new Set(de.map((f) => f.supplierId)).size,
      facturas: de.reduce((s, f) => s + f.facturas, 0),
      facturado: suma("facturado"), pagado: suma("pagado"), adelantos: suma("adelantos"), pendiente: suma("pendiente"),
    };
  });
  const enlace = (supplierId: string) => {
    const p = new URLSearchParams({ estado: "", proveedor: supplierId });
    if (desde) p.set("from", desde);
    if (hasta) p.set("to", hasta);
    return `/facturas?${p.toString()}`;
  };
  const rango = desde && hasta ? `del ${formatDate(desde)} al ${formatDate(hasta)}`
    : desde ? `desde el ${formatDate(desde)}` : hasta ? `hasta el ${formatDate(hasta)}` : "de todas las fechas";

  return (
    <>
      <p className="mb-3 text-sm text-steel-600">
        Facturas emitidas {rango}, sin las anuladas. Elige el rango con «Emitida desde» y «Emitida hasta».
      </p>

      {totales.length > 0 && (
        <dl className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="resumen-totales">
          {totales.flatMap((t) => [
            { k: `${t.currency}-f`, label: `Facturado (${t.facturas} facturas, ${t.proveedores} proveedores)`, v: t.facturado, tone: "" },
            { k: `${t.currency}-p`, label: "Pagado", v: t.pagado, tone: "text-emerald-700" },
            { k: `${t.currency}-a`, label: "Adelantos", v: t.adelantos, tone: "text-sky-700" },
            { k: `${t.currency}-s`, label: "Saldo pendiente", v: t.pendiente, tone: "text-[#9A7000]" },
          ].map((c) => (
            <div key={c.k} className="rounded-lg border border-steel-200 bg-white p-4">
              <dt className="text-sm text-steel-500">{c.label}</dt>
              <dd className={`mt-1 font-display text-xl font-bold tabular ${c.tone || "text-ink"}`}>{formatMoney(c.v, t.currency)}</dd>
            </div>
          )))}
        </dl>
      )}

      <TableShell>
        <thead>
          <tr>
            <Th>Proveedor</Th>
            <Th className="text-right">Facturas</Th>
            <Th className="text-right">Total facturado</Th>
            <Th className="text-right">Pagado</Th>
            <Th className="text-right">Adelantos</Th>
            <Th className="text-right">Saldo pendiente</Th>
            <Th className="text-right"><span className="sr-only">Ver</span></Th>
          </tr>
        </thead>
        <tbody data-testid="resumen-proveedores">
          {filas.length === 0 && (
            <EmptyRow colSpan={7} title="No hay facturas en ese rango" hint="Prueba con otras fechas o quita el proveedor elegido." />
          )}
          {filas.map((f) => (
            <Tr key={`${f.supplierId}-${f.currency}`}>
              <Td>
                <p className="font-medium">{f.proveedor}</p>
                <p className="text-xs text-steel-500">RUC {f.ruc}{monedas.length > 1 && ` · ${f.currency === "USD" ? "Dólares" : "Soles"}`}</p>
              </Td>
              <Td className="text-right tabular">
                {f.facturas}
                {f.pagadas > 0 && <p className="text-xs text-steel-500">{f.pagadas} pagada(s)</p>}
              </Td>
              <Td className="whitespace-nowrap text-right tabular font-semibold">{formatMoney(f.facturado, f.currency)}</Td>
              <Td className="whitespace-nowrap text-right tabular text-emerald-700">{formatMoney(f.pagado, f.currency)}</Td>
              <Td className="whitespace-nowrap text-right tabular text-sky-700">{Number(f.adelantos) > 0 ? formatMoney(f.adelantos, f.currency) : "—"}</Td>
              <Td className="whitespace-nowrap text-right tabular font-semibold text-[#9A7000]">
                {Number(f.pendiente) > 0 ? formatMoney(f.pendiente, f.currency) : <span className="font-normal text-steel-400">Al día</span>}
              </Td>
              <Td className="text-right">
                <Link href={enlace(f.supplierId)} className="whitespace-nowrap text-sm font-medium text-steel-700 hover:text-ink hover:underline">
                  Ver facturas
                </Link>
              </Td>
            </Tr>
          ))}
        </tbody>
      </TableShell>

      <p className="mt-3 text-xs text-steel-500">
        Total facturado = pagado + adelantos + saldo pendiente. Los adelantos son los entregados a cuenta de facturas que
        siguen por pagar. El saldo pendiente incluye la detracción, que se deposita aparte en el Banco de la Nación.
      </p>
    </>
  );
}
