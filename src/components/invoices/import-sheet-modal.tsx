"use client";

import { AlertTriangle, FileSpreadsheet, Upload } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { analizarFacturasDeExcel, importarFacturasDeExcel, type AnalisisHoja } from "@/actions/invoice-import";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { controlClass } from "@/components/ui/field";
import { EmptyRow, TableShell, Td, Th, Tr } from "@/components/ui/table";
import { cn, formatDate, formatMoney, INVOICE_STATUS_LABEL } from "@/lib/utils";
import { useRouter } from "next/navigation";

/**
 * Importar el control de facturas que se lleva en Excel.
 *
 * Primero se analiza el archivo y se muestra qué va a pasar con cada fila; recién después
 * se escribe. Y se puede subir la misma hoja cuantas veces haga falta: lo ya registrado se
 * reconoce por proveedor, serie y número, así que una segunda carga solo trae lo nuevo.
 */
export function ImportSheetModal() {
  const [abierto, setAbierto] = useState(false);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [analisis, setAnalisis] = useState<AnalisisHoja | null>(null);
  const [analizando, analizar] = useTransition();
  const [importando, importar] = useTransition();
  const entrada = useRef<HTMLInputElement>(null);
  const { notify } = useToast();
  const router = useRouter();

  const cerrar = () => {
    if (analizando || importando) return;
    setAbierto(false);
    setArchivo(null);
    setAnalisis(null);
  };

  const elegir = (f: File | null) => {
    setArchivo(f);
    setAnalisis(null);
    if (!f) return;
    const fd = new FormData();
    fd.set("archivo", f);
    analizar(async () => setAnalisis(await analizarFacturasDeExcel(fd)));
  };

  const confirmar = () => {
    if (!archivo) return;
    const fd = new FormData();
    fd.set("archivo", archivo);
    importar(async () => {
      const r = await importarFacturasDeExcel(fd);
      notify(r.ok ? "success" : "error", r.message);
      if (r.ok) { cerrar(); router.refresh(); }
    });
  };

  const listo = analisis?.ok ? analisis : null;
  const porImportar = listo?.nuevas.length ?? 0;

  return (
    <>
      <Button variant="outline" onClick={() => setAbierto(true)}>
        <FileSpreadsheet className="h-4 w-4" /> Importar de Excel
      </Button>

      <Modal
        open={abierto}
        onClose={cerrar}
        title="Importar facturas desde Excel"
        description="El control que se lleva en la hoja de cálculo, tal cual. Primero se revisa y después se guarda."
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={cerrar} disabled={analizando || importando}>Cancelar</Button>
            <Button onClick={confirmar} loading={importando} disabled={!listo || porImportar === 0 || analizando}>
              <Upload className="h-4 w-4" />
              {porImportar > 0 ? `Importar ${porImportar} factura(s)` : "Importar"}
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-ink">Archivo de Excel</span>
            <input
              ref={entrada}
              type="file"
              accept=".xlsx,.xlsm"
              onChange={(e) => elegir(e.target.files?.[0] ?? null)}
              className={cn(controlClass, "h-10 py-1.5 file:mr-3 file:rounded file:border-0 file:bg-steel-100 file:px-3 file:py-1.5 file:text-sm")}
            />
            <span className="text-xs text-steel-500">
              Se busca sola la hoja del control y sus columnas por el nombre, así que no importa el orden en que estén.
            </span>
          </label>

          {analizando && <p className="text-sm text-steel-600">Leyendo la hoja…</p>}

          {analisis && !analisis.ok && (
            <p className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {analisis.message}
            </p>
          )}

          {listo && (
            <>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { k: "Se importarán", v: porImportar, d: formatMoney(listo.importe.toFixed(2)), alerta: false },
                  { k: "Ya registradas", v: listo.repetidas, d: "se saltan", alerta: false },
                  { k: "Con problemas", v: listo.problemas.length, d: "quedan fuera", alerta: listo.problemas.length > 0 },
                  { k: "Proveedores nuevos", v: listo.proveedoresNuevos.length, d: "se crean sin RUC", alerta: false },
                ].map((t) => (
                  <div key={t.k} className={cn("rounded-lg border bg-white p-3", t.alerta ? "border-red-300" : "border-steel-200")}>
                    <dt className="text-xs text-steel-500">{t.k}</dt>
                    <dd className={cn("font-display text-xl font-bold", t.alerta ? "text-red-700" : "text-ink")}>{t.v}</dd>
                    <dd className="text-xs text-steel-500">{t.d}</dd>
                  </div>
                ))}
              </dl>

              <p className="text-sm text-steel-600">
                Hoja <strong className="text-ink">{listo.hoja}</strong>, {listo.leidas} fila(s) leída(s).
                {listo.columnasIgnoradas.length > 0 && (
                  <> No se usan estas columnas: {listo.columnasIgnoradas.join(", ")}.</>
                )}
              </p>

              {listo.proveedoresNuevos.length > 0 && (
                <p className="rounded-md border border-brand/60 bg-brand-soft px-3 py-2.5 text-sm text-[#7A5A00]">
                  Se crearán {listo.proveedoresNuevos.length} proveedor(es) que no estaban:{" "}
                  {listo.proveedoresNuevos.slice(0, 6).join(", ")}
                  {listo.proveedoresNuevos.length > 6 && `, y ${listo.proveedoresNuevos.length - 6} más`}.
                  La hoja no trae el RUC, así que quedan sin él hasta que llegue una factura electrónica suya.
                </p>
              )}

              {listo.diferenciasDetraccion.length > 0 && (
                <p className="rounded-md border border-steel-200 bg-steel-50 px-3 py-2.5 text-sm text-steel-600">
                  En {listo.diferenciasDetraccion.length} detracción(es) ya depositada(s), el importe de la hoja no
                  coincide con el 4 % redondeado. Se conserva el de la hoja, porque es el que figura en la constancia
                  del banco.
                </p>
              )}

              {listo.problemas.length > 0 && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
                  <p className="font-semibold">Estas filas quedan fuera:</p>
                  <ul className="mt-1 grid gap-0.5">
                    {listo.problemas.slice(0, 8).map((p) => (
                      <li key={p.fila}>Fila {p.fila} — {p.detalle}</li>
                    ))}
                    {listo.problemas.length > 8 && <li>…y {listo.problemas.length - 8} más.</li>}
                  </ul>
                  <p className="mt-1.5 text-xs">
                    Las demás sí se importan. Corrige estas en el Excel y vuelve a subirlo: lo ya cargado no se duplica.
                  </p>
                </div>
              )}

              <div className="max-h-72 overflow-y-auto">
                <TableShell>
                  <thead>
                    <tr>
                      <Th>Fila</Th>
                      <Th>Factura</Th>
                      <Th>Proveedor</Th>
                      <Th>Emisión</Th>
                      <Th className="text-right">Importe</Th>
                      <Th className="text-right">Detracción</Th>
                      <Th>Estado</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {porImportar === 0 && (
                      <EmptyRow
                        colSpan={7}
                        title={listo.repetidas > 0 ? "Todo lo de la hoja ya está registrado" : "No hay facturas que importar"}
                      />
                    )}
                    {listo.nuevas.slice(0, 300).map((n) => (
                      <Tr key={`${n.fila}-${n.comprobante}`}>
                        <Td className="tabular text-steel-500">{n.fila}</Td>
                        <Td className="whitespace-nowrap font-semibold tabular">{n.comprobante}</Td>
                        <Td>
                          {n.proveedor}
                          {n.proveedorNuevo && <span className="ml-1 text-xs text-brand-ink">· nuevo</span>}
                        </Td>
                        <Td className="whitespace-nowrap tabular text-steel-600">{formatDate(n.fecha)}</Td>
                        <Td className="whitespace-nowrap text-right tabular">{formatMoney(n.total?.toFixed(2))}</Td>
                        <Td className="whitespace-nowrap text-right tabular text-steel-600">
                          {n.detraccion > 0 ? formatMoney(n.detraccion.toFixed(2)) : "—"}
                        </Td>
                        <Td className="text-sm text-steel-600">{INVOICE_STATUS_LABEL[n.estado] ?? n.estado}</Td>
                      </Tr>
                    ))}
                  </tbody>
                </TableShell>
                {porImportar > 300 && (
                  <p className="px-1 py-2 text-xs text-steel-500">Se muestran las primeras 300; se importarán todas.</p>
                )}
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
