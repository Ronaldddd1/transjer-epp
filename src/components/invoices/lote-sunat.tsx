"use client";

import { Ban, Download, FileUp, Landmark } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { anularLote, crearLoteDetracciones, registrarPagoLote } from "@/actions/detraction-batches";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { DateInput } from "@/components/ui/date-field";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormModal } from "@/components/ui/form-modal";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { VoucherField } from "@/components/ui/voucher-field";
import { formatMoney, todayLima } from "@/lib/utils";

/** El formulario al que pertenecen las casillas de la tabla. */
export const FORM_LOTE = "lote-sunat";

type Marcada = {
  id: string;
  factura: string;
  monto: number;
  proveedorId: string;
  proveedor: string;
  cuenta: string;
};

function leerMarcadas(): Marcada[] {
  return [...document.querySelectorAll<HTMLInputElement>(`input[type=checkbox][form="${FORM_LOTE}"][name=ids]:checked`)]
    .map((c) => ({
      id: c.value,
      factura: c.dataset.factura ?? "",
      monto: Number(c.dataset.monto ?? 0),
      proveedorId: c.dataset.proveedorId ?? "",
      proveedor: c.dataset.proveedor ?? "",
      cuenta: c.dataset.cuenta ?? "",
    }));
}

/** La casilla de la cabecera: marca o desmarca todas las de la página que se pueden. */
export function MarcarTodas() {
  const [todas, setTodas] = useState(false);
  useEffect(() => {
    const sync = () => {
      const casillas = [...document.querySelectorAll<HTMLInputElement>(`input[type=checkbox][form="${FORM_LOTE}"][name=ids]:not(:disabled)`)];
      setTodas(casillas.length > 0 && casillas.every((c) => c.checked));
    };
    document.addEventListener("change", sync);
    return () => document.removeEventListener("change", sync);
  }, []);
  return (
    <input
      type="checkbox"
      aria-label="Marcar todas las de esta página"
      title="Marcar todas las de esta página"
      className="h-4 w-4 accent-[#F5B800]"
      checked={todas}
      onChange={(e) => {
        const marcar = e.target.checked;
        document.querySelectorAll<HTMLInputElement>(`input[type=checkbox][form="${FORM_LOTE}"][name=ids]:not(:disabled)`)
          .forEach((c) => { c.checked = marcar; });
        setTodas(marcar);
        document.dispatchEvent(new Event("change"));
      }}
    />
  );
}

/**
 * La barra que aparece al marcar detracciones, y el formulario para armar el archivo de
 * "Depósitos Masivos" de SUNAT.
 */
export function LoteSunatBar({ propuesta }: {
  propuesta: { rucPagador: string; razonSocialPagador: string; lote: string };
}) {
  const [marcadas, setMarcadas] = useState<Marcada[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const { notify } = useToast();
  const router = useRouter();

  const sync = useCallback(() => setMarcadas(leerMarcadas()), []);
  useEffect(() => {
    sync();
    document.addEventListener("change", sync);
    return () => document.removeEventListener("change", sync);
  }, [sync]);

  const total = marcadas.reduce((s, m) => s + m.monto, 0);
  // Un proveedor sin cuenta aparece una sola vez, aunque tenga varias facturas.
  const sinCuenta = [...new Map(marcadas.filter((m) => !m.cuenta).map((m) => [m.proveedorId, m])).values()];

  const cerrar = () => { if (!pending) { setAbierto(false); setErrores({}); } };

  const enviar = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    for (const m of marcadas) fd.append("ids", m.id);
    start(async () => {
      const res = await crearLoteDetracciones(fd);
      if (!res.ok) {
        setErrores(res.fieldErrors ?? {});
        notify("error", res.message);
        return;
      }
      notify("success", res.message);
      setAbierto(false);
      setErrores({});
      if (res.loteId) window.location.href = `/api/detracciones/lotes/${res.loteId}`;
      router.refresh();
    });
  };

  if (marcadas.length === 0) {
    return (
      <p className="mb-3 text-sm text-steel-500">
        Marca las detracciones que vas a pagar juntas para armar el archivo de Depósitos Masivos de SUNAT.
      </p>
    );
  }

  return (
    <>
      <div className="sticky top-2 z-20 mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-brand bg-brand-soft px-4 py-3 text-sm text-ink shadow-sm">
        <span>
          <strong>{marcadas.length} marcada(s)</strong> · {formatMoney(total.toFixed(2))}
          {sinCuenta.length > 0 && (
            <span className="text-[#7A5A00]"> · {sinCuenta.length} proveedor(es) sin cuenta del Banco de la Nación</span>
          )}
        </span>
        <Button size="sm" className="ml-auto" onClick={() => setAbierto(true)}>
          <FileUp className="h-4 w-4" /> Armar archivo para SUNAT
        </Button>
      </div>

      <Modal
        open={abierto}
        onClose={cerrar}
        title="Pago masivo de detracciones"
        description="El archivo TXT para subir en SUNAT Operaciones en Línea, en Depósitos Masivos."
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={cerrar} disabled={pending}>Cancelar</Button>
            <Button type="submit" form="form-lote-sunat" loading={pending}>
              <Download className="h-4 w-4" /> Armar y descargar
            </Button>
          </>
        }
      >
        <form id="form-lote-sunat" onSubmit={enviar} noValidate className="grid gap-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md border border-steel-200 bg-steel-50 p-3 text-sm">
            <dt className="text-steel-500">Detracciones</dt><dd className="font-medium">{marcadas.length}</dd>
            <dt className="text-steel-500">Total a pagar</dt>
            <dd className="font-display text-base font-bold">{formatMoney(total.toFixed(2))}</dd>
          </dl>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="RUC de la empresa" name="rucPagador" required error={errores.rucPagador} hint="Quien hace el depósito.">
              <Input name="rucPagador" defaultValue={propuesta.rucPagador} maxLength={11} inputMode="numeric" invalid={!!errores.rucPagador} />
            </Field>
            <Field label="N.º de lote" name="lote" required error={errores.lote} hint="Año y correlativo: 260001, 260002… No se repite.">
              <Input name="lote" defaultValue={propuesta.lote} maxLength={6} inputMode="numeric" invalid={!!errores.lote} />
            </Field>
            <Field label="Razón social de la empresa" name="razonSocialPagador" required error={errores.razonSocialPagador} className="sm:col-span-2">
              <Input name="razonSocialPagador" defaultValue={propuesta.razonSocialPagador} maxLength={120} invalid={!!errores.razonSocialPagador} />
            </Field>
          </div>

          {sinCuenta.length > 0 && (
            <div className="grid gap-3 rounded-md border border-brand/60 bg-brand-soft/40 p-3">
              <p className="text-sm text-steel-700">
                Falta la cuenta de detracciones del Banco de la Nación de estos proveedores. Escríbela aquí y queda
                guardada en su ficha para la próxima vez.
              </p>
              {sinCuenta.map((m) => (
                <Field key={m.proveedorId} label={m.proveedor} name={`cuenta_${m.proveedorId}`} required error={errores[`cuenta_${m.proveedorId}`]}>
                  <Input name={`cuenta_${m.proveedorId}`} maxLength={15} inputMode="numeric" placeholder="00012345678" invalid={!!errores[`cuenta_${m.proveedorId}`]} />
                </Field>
              ))}
            </div>
          )}

          <p className="text-sm text-steel-600">
            Al armarlo, estas detracciones pasan a <strong>En proceso</strong>. Sube el archivo en SUNAT, paga, y después
            registra el pago del lote con la constancia: todas quedan pagadas a la vez.
          </p>
        </form>
      </Modal>
    </>
  );
}

export type LoteParaPagar = {
  id: string;
  lot: string;
  total: string;
  facturas: { id: string; etiqueta: string; proveedor: string; monto: string; enProceso: boolean }[];
};

/** Paso 3: la constancia del pago en SUNAT deja pagadas todas las detracciones del lote. */
export function PagoLoteModal({ lote }: { lote: LoteParaPagar }) {
  const pendientes = lote.facturas.filter((f) => f.enProceso);
  return (
    <FormModal
      title={`Pago del lote ${lote.lot}`}
      description="Con la constancia de SUNAT, todas las detracciones del lote quedan pagadas."
      submitLabel="Registrar el pago"
      size="md"
      action={(fd) => registrarPagoLote(lote.id, fd)}
      trigger={(open) => (
        <Button size="sm" onClick={open}>
          <Landmark className="h-4 w-4" /> Registrar pago
        </Button>
      )}
    >
      {({ errors }) => (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md border border-steel-200 bg-steel-50 p-3 text-sm">
            <dt className="text-steel-500">Detracciones</dt><dd className="font-medium">{pendientes.length}</dd>
            <dt className="text-steel-500">Total</dt><dd className="font-display text-base font-bold">{formatMoney(lote.total)}</dd>
          </dl>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Fecha del pago" name="fecha" required error={errors.fecha}>
              <DateInput name="fecha" defaultValue={todayLima()} max={todayLima()} required invalid={!!errors.fecha} />
            </Field>
            <Field label="N.º de operación u orden de pago" name="operacion" required error={errors.operacion} hint="El que da SUNAT al pagar.">
              <Input name="operacion" maxLength={40} invalid={!!errors.operacion} />
            </Field>
          </div>
          <VoucherField
            requerido
            etiqueta="Constancia del pago"
            error={errors.voucher}
            ayuda="La captura o el PDF de la constancia de SUNAT. Queda guardada en todas las detracciones del lote."
          />
          <details className="rounded-md border border-steel-200 px-3 py-2 text-sm">
            <summary className="cursor-pointer text-steel-700">
              N.º de constancia de cada detracción (opcional)
            </summary>
            <p className="mt-2 text-steel-500">
              SUNAT da un número de constancia por cada depósito. Si los tienes, anótalos; si no, se usa el número de
              operación.
            </p>
            <div className="mt-2 grid gap-2">
              {pendientes.map((f) => (
                <label key={f.id} className="grid gap-1 sm:grid-cols-[1fr_10rem] sm:items-center">
                  <span className="text-steel-700">
                    {f.etiqueta} <span className="text-steel-500">· {f.proveedor} · {formatMoney(f.monto)}</span>
                  </span>
                  <Input name={`constancia_${f.id}`} maxLength={40} inputMode="numeric" aria-label={`Constancia de ${f.etiqueta}`} />
                </label>
              ))}
            </div>
          </details>
          <Field label="Observaciones" name="notas" error={errors.notas}>
            <Textarea name="notas" maxLength={1000} rows={2} />
          </Field>
        </>
      )}
    </FormModal>
  );
}

export function AnularLoteButton({ id, lot }: { id: string; lot: string }) {
  return (
    <ConfirmButton
      action={() => anularLote(id)}
      title={`Anular el lote ${lot}`}
      message="Úsalo solo si el archivo no se llegó a pagar en SUNAT. Sus detracciones vuelven a pendientes y el número de lote no se vuelve a usar."
      confirmLabel="Anular el lote"
      triggerLabel={<><Ban className="h-4 w-4" /> Anular</>}
      triggerTitle="Anular el lote sin pagar"
    />
  );
}
