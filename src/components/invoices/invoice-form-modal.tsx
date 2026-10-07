"use client";

import { FileText, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { createInvoice, importInvoiceFromFiles, updateInvoice } from "@/actions/invoices";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { DateInput } from "@/components/ui/date-field";
import { FormModal } from "@/components/ui/form-modal";
import {
  computePayDueDate, DEFAULT_TERM_DAYS, detractionFor, DETRACTION_THRESHOLD, formatDate,
  formatMoney, INVOICE_DOC_TYPE_LABEL, todayLima, type PaymentTermKey,
} from "@/lib/utils";

export type SupplierOption = {
  id: string; ruc: string | null; name: string;
  defaultPaymentTerm: PaymentTermKey;
  defaultTermDays: number;
};

export type InvoiceFormValues = {
  id: string;
  supplierId: string;
  docType: string;
  series: string;
  number: string;
  issueDate: string;
  dueDate: string | null;
  serviceDate: string | null;
  currency: string;
  subtotal: string | null;
  igv: string | null;
  total: string;
  description: string | null;
  grtNumber: string | null;
  notes: string | null;
  receptionDate: string;
  paymentTerm: string;
  termDays: number;
  guideReceivedAt: string | null;
  contactName: string | null;
  plate: string | null;
  clientName: string | null;
  originCity: string | null;
  destinationCity: string | null;
  volumeM3: string | null;
  weightTn: string | null;
  advances: string | null;
};

const IGV_RATE = 0.18;

export function InvoiceFormModal({ suppliers, invoice, clients = [] }: { suppliers: SupplierOption[]; invoice?: InvoiceFormValues; clients?: string[] }) {
  const editing = !!invoice;
  const [currency, setCurrency] = useState(invoice?.currency ?? "PEN");
  const [subtotal, setSubtotal] = useState(invoice?.subtotal ?? "");
  const [igv, setIgv] = useState(invoice?.igv ?? "");
  const [total, setTotal] = useState(invoice?.total ?? "");

  // Condición de pago: decide desde cuándo corre el plazo y si hace falta la guía.
  const [supplierId, setSupplierId] = useState(invoice?.supplierId ?? "");
  const [term, setTerm] = useState<PaymentTermKey>((invoice?.paymentTerm as PaymentTermKey) ?? "CONTADO");
  const [termDays, setTermDays] = useState(String(invoice?.termDays ?? DEFAULT_TERM_DAYS.CONTADO));
  const [received, setReceived] = useState(invoice?.receptionDate ?? todayLima());
  const [guide, setGuide] = useState(invoice?.guideReceivedAt ?? "");

  /** Al elegir proveedor se propone lo pactado con él; se puede cambiar en esta factura. */
  const onSupplier = (id: string) => {
    setSupplierId(id);
    if (editing) return;
    const s = suppliers.find((x) => x.id === id);
    if (!s) return;
    setTerm(s.defaultPaymentTerm);
    setTermDays(String(s.defaultTermDays));
  };

  const onTerm = (value: PaymentTermKey) => {
    setTerm(value);
    setTermDays(String(DEFAULT_TERM_DAYS[value]));
    if (value === "CONTADO") setGuide("");
  };

  const detraccion = detractionFor(total, undefined, currency);

  const vence = computePayDueDate({
    paymentTerm: term,
    termDays: Number(termDays) || 0,
    receptionYmd: received || todayLima(),
    guideReceivedAt: guide || null,
  });

  /**
   * El subtotal propone el IGV y el total, pero solo mientras nadie los haya tocado.
   *
   * Antes los reescribía siempre: si la encargada escribía el total del comprobante y
   * después corregía un dígito del subtotal, el total se recalculaba y se perdía el importe
   * real. En una factura ya registrada eso cambiaba además lo que se paga y la detracción.
   */
  const [totalAMano, setTotalAMano] = useState(editing);
  const [igvAMano, setIgvAMano] = useState(editing);

  const onSubtotal = (value: string) => {
    setSubtotal(value);
    const n = Number(value.replace(/,/g, ""));
    const hayImporte = Number.isFinite(n) && n > 0;
    const tax = hayImporte ? n * IGV_RATE : 0;
    // Si se borra el subtotal, lo propuesto se va con él: un IGV calculado sobre un
    // subtotal que ya no existe es un dato inventado.
    if (!igvAMano) setIgv(hayImporte ? tax.toFixed(2) : "");
    if (!totalAMano) setTotal(hayImporte ? (n + tax).toFixed(2) : "");
  };

  /** Deja el formulario como nuevo al cerrarlo: si no, la siguiente factura hereda la anterior. */
  const limpiar = () => {
    if (editing) return;
    setCurrency("PEN");
    setSubtotal(""); setIgv(""); setTotal("");
    setIgvAMano(false); setTotalAMano(false);
    setSupplierId(""); setTerm("CONTADO"); setTermDays(String(DEFAULT_TERM_DAYS.CONTADO));
    setReceived(todayLima()); setGuide("");
  };

  return (
    <FormModal
      title={editing ? `Editar ${invoice.series}-${invoice.number}` : "Nueva factura"}
      description={editing ? "Corrige los datos del comprobante registrado." : "Registra una factura de proveedor por servicios de transporte."}
      submitLabel={editing ? "Guardar cambios" : "Registrar factura"}
      size="lg"
      action={(fd) => (editing ? updateInvoice(invoice.id, fd) : createInvoice(fd))}
      onClosed={limpiar}
      trigger={(open) =>
        editing ? (
          <Button variant="outline" size="sm" onClick={open}><Pencil className="h-4 w-4" /> Editar</Button>
        ) : (
          <Button onClick={open}><Plus className="h-4 w-4" /> Nueva factura</Button>
        )
      }
    >
      {({ errors }) => (
        <div className="grid gap-4 sm:grid-cols-6">
          <Field label="Proveedor" name="supplierId" required error={errors.supplierId} className="sm:col-span-6">
            <Select name="supplierId" value={supplierId} onChange={(e) => onSupplier(e.target.value)} invalid={!!errors.supplierId}>
              <option value="" disabled>{suppliers.length ? "Selecciona un proveedor…" : "No hay proveedores activos"}</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}{s.ruc ? ` — RUC ${s.ruc}` : " — sin RUC"}</option>)}
            </Select>
          </Field>

          <Field label="Tipo" name="docType" required error={errors.docType} className="sm:col-span-2">
            <Select name="docType" defaultValue={invoice?.docType ?? "FACTURA"}>
              {Object.entries(INVOICE_DOC_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Serie" name="series" required error={errors.series} hint="Ejemplo: F001" className="sm:col-span-2">
            <Input name="series" defaultValue={invoice?.series ?? ""} invalid={!!errors.series} className="uppercase" maxLength={8} placeholder="F001" />
          </Field>
          <Field label="Número" name="number" required error={errors.number} hint="Ejemplo: 2589" className="sm:col-span-2">
            <Input name="number" defaultValue={invoice?.number ?? ""} invalid={!!errors.number} maxLength={12} inputMode="numeric" placeholder="2589" />
          </Field>

          <Field label="Fecha de emisión" name="issueDate" required error={errors.issueDate} className="sm:col-span-2">
            <DateInput name="issueDate" defaultValue={invoice?.issueDate ?? todayLima()} required invalid={!!errors.issueDate} />
          </Field>
          <Field label="Llegó el correo" name="receivedDate" required error={errors.receivedDate} hint="Desde aquí corre el plazo." className="sm:col-span-2">
            <DateInput name="receivedDate" value={received} onChange={(v) => setReceived(v ?? "")} max={todayLima()} required invalid={!!errors.receivedDate} />
          </Field>
          <Field label="Vencimiento del comprobante" name="dueDate" error={errors.dueDate} hint="El que dice la factura." className="sm:col-span-2">
            <DateInput name="dueDate" defaultValue={invoice?.dueDate ?? ""} invalid={!!errors.dueDate} />
          </Field>

          {/* Condición de pago: contado corre desde el correo, crédito desde la guía en físico. */}
          <div className="rounded-lg border border-steel-200 bg-steel-50 p-4 sm:col-span-6">
            <div className="grid gap-4 sm:grid-cols-6">
              <Field label="Condición de pago" name="paymentTerm" required error={errors.paymentTerm} className="sm:col-span-2">
                <Select name="paymentTerm" value={term} onChange={(e) => onTerm(e.target.value as PaymentTermKey)}>
                  <option value="CONTADO">Contado</option>
                  <option value="CREDITO">Crédito</option>
                </Select>
              </Field>
              <Field label="Días de plazo" name="termDays" required error={errors.termDays} className="sm:col-span-2">
                <Input name="termDays" value={termDays} onChange={(e) => setTermDays(e.target.value)} inputMode="numeric" invalid={!!errors.termDays} />
              </Field>
              {term === "CREDITO" && (
                <Field
                  label="Guía entregada el"
                  name="guideReceivedAt"
                  error={errors.guideReceivedAt}
                  hint="Cuando el proveedor la trajo en físico."
                  className="sm:col-span-2"
                >
                  <DateInput name="guideReceivedAt" value={guide} onChange={(v) => setGuide(v ?? "")} max={todayLima()} invalid={!!errors.guideReceivedAt} />
                </Field>
              )}
            </div>

            <p className="mt-3 border-t border-steel-200 pt-3 text-sm">
              {vence ? (
                <>
                  <span className="text-steel-600">Fecha límite de pago: </span>
                  <strong className="text-ink">{formatDate(vence)}</strong>
                  <span className="text-steel-500">
                    {term === "CONTADO"
                      ? ` · ${termDays} día(s) desde que llegó el correo`
                      : ` · ${termDays} día(s) desde la entrega de la guía`}
                  </span>
                </>
              ) : (
                <span className="text-sky-800">
                  A crédito, el plazo recién empieza cuando el proveedor entregue la guía en físico.
                  Si todavía no la trae, deja la fecha vacía y anótala después desde la ficha de la factura.
                </span>
              )}
            </p>
          </div>

          <Field label="Moneda" name="currency" required error={errors.currency} className="sm:col-span-2">
            <Select name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="PEN">Soles (S/)</option>
              <option value="USD">Dólares (US$)</option>
            </Select>
          </Field>
          <Field label="Subtotal" name="subtotal" error={errors.subtotal} hint="Opcional: calcula el IGV." className="sm:col-span-2">
            <Input name="subtotal" value={subtotal} onChange={(e) => onSubtotal(e.target.value)} inputMode="decimal" placeholder="1000.00" invalid={!!errors.subtotal} />
          </Field>
          <Field label="IGV" name="igv" error={errors.igv} className="sm:col-span-2">
            <Input name="igv" value={igv} onChange={(e) => { setIgvAMano(true); setIgv(e.target.value); }} inputMode="decimal" placeholder="180.00" invalid={!!errors.igv} />
          </Field>

          <Field label="Importe total" name="total" required error={errors.total} hint="Es el importe que se pagará." className="sm:col-span-3">
            <Input name="total" value={total} onChange={(e) => { setTotalAMano(true); setTotal(e.target.value); }} inputMode="decimal" placeholder="1180.00" invalid={!!errors.total} />
          </Field>
          {detraccion.applies ? (
            <p className="rounded-md border border-steel-200 bg-steel-50 px-3 py-2 text-sm text-steel-600 sm:col-span-6">
              Detracción del 4 %: <strong className="text-ink">{formatMoney(detraccion.amount.toFixed(2))}</strong>.
              Al proveedor se le pagan <strong className="text-ink">{formatMoney(detraccion.netPayable.toFixed(2))}</strong> y
              el resto va al Banco de la Nación. Se calcula solo al guardar.
            </p>
          ) : Number(total) > 0 ? (
            <p className="rounded-md border border-steel-200 bg-steel-50 px-3 py-2 text-sm text-steel-600 sm:col-span-6">
              {currency === "PEN"
                ? `Sin detracción: la operación no supera los S/ ${DETRACTION_THRESHOLD}.`
                : "Sin detracción automática: el depósito se hace en soles, así que una factura en dólares se trata a mano."}
            </p>
          ) : null}

          <Field label="Guía de remisión (GRT)" name="grtNumber" error={errors.grtNumber} hint="Ejemplo: T001-000123" className="sm:col-span-3">
            <Input name="grtNumber" defaultValue={invoice?.grtNumber ?? ""} maxLength={40} />
          </Field>
          <Field label="Fecha del servicio" name="serviceDate" error={errors.serviceDate} className="sm:col-span-3">
            <DateInput name="serviceDate" defaultValue={invoice?.serviceDate ?? ""} />
          </Field>

          {/* Datos del servicio: es lo que el control en Excel anotaba por cada flete y lo que
              permite saber después qué viaje se está pagando. Todo es opcional. */}
          <details className="rounded-lg border border-steel-200 bg-steel-50 sm:col-span-6" open={!!invoice?.plate || !!invoice?.clientName}>
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink">
              Datos del servicio de transporte
              <span className="ml-2 font-normal text-steel-500">placa, cliente, ruta y carga</span>
            </summary>
            <div className="grid gap-4 border-t border-steel-200 p-4 sm:grid-cols-6">
              <Field label="Cliente" name="clientName" error={errors.clientName} hint="Para quién se hizo el flete." className="sm:col-span-2">
                <Input name="clientName" defaultValue={invoice?.clientName ?? ""} maxLength={120} list="clientes-conocidos" placeholder="Winter" />
                <datalist id="clientes-conocidos">
                  {clients.map((c) => <option key={c} value={c} />)}
                </datalist>
              </Field>
              <Field label="Placa" name="plate" error={errors.plate} className="sm:col-span-2">
                <Input name="plate" defaultValue={invoice?.plate ?? ""} maxLength={24} className="uppercase" placeholder="D7S943" />
              </Field>
              <Field label="Contacto" name="contactName" error={errors.contactName} hint="Quién coordinó el viaje." className="sm:col-span-2">
                <Input name="contactName" defaultValue={invoice?.contactName ?? ""} maxLength={120} placeholder="Carlos Dávila" />
              </Field>

              <Field label="Origen" name="originCity" error={errors.originCity} className="sm:col-span-2">
                <Input name="originCity" defaultValue={invoice?.originCity ?? ""} maxLength={80} placeholder="Lima" />
              </Field>
              <Field label="Destino" name="destinationCity" error={errors.destinationCity} className="sm:col-span-2">
                <Input name="destinationCity" defaultValue={invoice?.destinationCity ?? ""} maxLength={120} placeholder="Trujillo - Piura" />
              </Field>
              <Field label="Adelantos" name="advances" error={errors.advances} hint="Pagos a cuenta ya entregados." className="sm:col-span-2">
                <Input name="advances" defaultValue={invoice?.advances ?? ""} inputMode="decimal" placeholder="0.00" invalid={!!errors.advances} />
              </Field>

              <Field label="Volumen (m³)" name="volumeM3" error={errors.volumeM3} className="sm:col-span-3">
                <Input name="volumeM3" defaultValue={invoice?.volumeM3 ?? ""} inputMode="decimal" placeholder="50" />
              </Field>
              <Field label="Peso (toneladas)" name="weightTn" error={errors.weightTn} className="sm:col-span-3">
                <Input name="weightTn" defaultValue={invoice?.weightTn ?? ""} inputMode="decimal" placeholder="8" />
              </Field>
            </div>
          </details>

          <Field label="Concepto del servicio" name="description" error={errors.description} className="sm:col-span-6">
            <Input name="description" defaultValue={invoice?.description ?? ""} maxLength={250} placeholder="Servicio de transporte Lima - Trujillo" />
          </Field>
          <Field label="Observaciones" name="notes" error={errors.notes} className="sm:col-span-6">
            <Textarea name="notes" defaultValue={invoice?.notes ?? ""} maxLength={1000} rows={2} />
          </Field>
        </div>
      )}
    </FormModal>
  );
}

/** Registro rápido leyendo el XML del comprobante electrónico. */
export function ImportInvoiceModal({ maxMb }: { maxMb: number }) {
  return (
    <FormModal
      title="Cargar factura desde el XML"
      description="Selecciona el XML del comprobante y, si lo tienes, el PDF y la guía de remisión. Los datos se leen solos."
      submitLabel="Leer y registrar"
      size="md"
      action={importInvoiceFromFiles}
      trigger={(open) => (
        <Button variant="outline" onClick={open}><FileText className="h-4 w-4" /> Cargar XML</Button>
      )}
    >
      {({ errors }) => (
        <>
          <Field
            label="Archivos del comprobante"
            name="files"
            required
            error={errors.files ?? errors.form}
            hint={`XML obligatorio. Puedes añadir el PDF y la guía. Máximo ${maxMb} MB por archivo.`}
          >
            <input
              id="files"
              name="files"
              type="file"
              multiple
              accept=".xml,.zip,.pdf,.png,.jpg,.jpeg"
              className="w-full rounded-md border border-steel-300 bg-white p-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-sm file:text-white hover:file:bg-ink-700"
            />
          </Field>
          <p className="rounded-md border border-steel-200 bg-steel-50 p-3 text-sm text-steel-600">
            El XML es el archivo que SUNAT exige junto a la factura. De ahí se leen el proveedor, la serie,
            el número, la fecha y los importes, así no hay que escribirlos a mano.
          </p>
        </>
      )}
    </FormModal>
  );
}
