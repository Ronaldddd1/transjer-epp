"use client";

import { AlertTriangle, Check, Eye, FileMinus2, FileText, Mail, MailX, Scale, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { applyCreditNoteEmail, approveEmail, rejectEmail, verifyEmailAmount } from "@/actions/mailbox";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { DateInput } from "@/components/ui/date-field";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormModal } from "@/components/ui/form-modal";
import { Modal } from "@/components/ui/modal";
import {
  AMOUNT_CHECK_LABEL, cn, compararMonto,
  DEFAULT_TERM_DAYS, formatDate, formatDateTime, formatFileSize, formatMoney,
  INVOICE_DOC_TYPE_LABEL, INVOICE_SERVICE_TYPE_LABEL, invoiceNumber, PIDEN_NOTA_DE_CREDITO,
  REJECT_REASON_LABEL,
  rejectionEmailBody, TERM_DAYS_BY_SERVICE_TYPE,
  type AmountCheckKey, type InvoiceServiceTypeKey, type PaymentTermKey, type RejectReasonKey,
} from "@/lib/utils";

/**
 * Los datos del comprobante, tal como se leyeron del XML que mandó el proveedor.
 *
 * Es lo que se mira para decidir. Se muestra en la misma pantalla del buzón: antes había
 * que abrir el PDF adjunto para saber de qué se trataba, y eso es justo lo que vuelve
 * lento revisar veinte correos.
 */
export type ComprobanteLeido = {
  docType: string;
  /** La factura que esta nota de crédito anula, según su propio XML. */
  referencedDoc?: string | null;
  series: string;
  number: string;
  issueDate: string;
  dueDate: string | null;
  currency: string;
  subtotal: string | null;
  igv: string | null;
  total: string;
  supplierRuc: string;
  supplierName: string;
  customerRuc: string | null;
  description: string | null;
  grtNumber: string | null;
};

export type ArchivoCorreo = { id: string; filename: string; sizeBytes: number };

export type CorreoParaDecidir = {
  id: string;
  subject: string | null;
  fromName: string | null;
  fromAddress: string | null;
  receivedAt: string;
  status: string;
  detail: string | null;
  comprobante: ComprobanteLeido | null;
  archivos: ArchivoCorreo[];
  /** El filtro del monto, que va antes de aceptar o rechazar. */
  monto: {
    estado: AmountCheckKey;
    pactado: string | null;
    nota: string | null;
    verificadoEl: string | null;
  };
  rejectReason: string | null;
  rejectComment: string | null;
  replyTo: string | null;
  replySentAt: string | null;
  replyError: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
  /** Si el concepto tiene pinta de viaje, para proponer el tipo al aprobar. */
  pareceTransporte?: boolean;
  /** Lo que se pudo leer del concepto del XML: fecha, placa, cliente, ruta y guías. */
  viaje?: {
    leido: boolean;
    serviceDate: string | null;
    plate: string | null;
    clientName: string | null;
    originCity: string | null;
    destinationCity: string | null;
    grtNumber: string | null;
    dispatchNote: string | null;
  } | null;
};

export function etiquetaComprobante(c: ComprobanteLeido | null) {
  return c ? invoiceNumber(c.series, c.number) : null;
}

/** Una línea del cuadro de datos: rótulo arriba, valor abajo. */
function Dato({ label, children, ancho = "" }: { label: string; children: React.ReactNode; ancho?: string }) {
  return (
    <div className={ancho}>
      <dt className="text-xs text-steel-500">{label}</dt>
      <dd className="text-sm font-medium text-ink">{children}</dd>
    </div>
  );
}

/** El comprobante leído, en un cuadro. Se usa igual al ver, al aceptar y al rechazar. */
export function DatosComprobante({ correo }: { correo: CorreoParaDecidir }) {
  const c = correo.comprobante;
  if (!c) {
    return (
      <p className="rounded-md border border-steel-200 bg-steel-50 px-4 py-3 text-sm text-steel-600">
        De este correo no se pudo leer el XML, así que no hay datos del comprobante. Se registra a mano.
      </p>
    );
  }

  // formatMoney ya pone el símbolo que corresponde a la moneda del comprobante.
  const importe = (v: string | null) => (v ? formatMoney(v, c.currency) : "—");
  return (
    <div className="rounded-lg border border-steel-200">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-steel-200 bg-steel-50 px-4 py-2.5">
        <p className="font-display text-lg font-bold">
          {INVOICE_DOC_TYPE_LABEL[c.docType as keyof typeof INVOICE_DOC_TYPE_LABEL] ?? c.docType} {invoiceNumber(c.series, c.number)}
        </p>
        <p className="font-display text-xl font-bold tabular">{importe(c.total)}</p>
      </div>
      <dl className="grid gap-3 px-4 py-3 sm:grid-cols-3">
        <Dato label="Proveedor" ancho="sm:col-span-2">{c.supplierName}</Dato>
        <Dato label="RUC">{c.supplierRuc}</Dato>
        <Dato label="Emitida">{formatDate(c.issueDate)}</Dato>
        <Dato label="Vence">{c.dueDate ? formatDate(c.dueDate) : "—"}</Dato>
        <Dato label="Guía de remisión">{c.grtNumber ?? "—"}</Dato>
        <Dato label="Subtotal">{importe(c.subtotal)}</Dato>
        <Dato label="IGV">{importe(c.igv)}</Dato>
        <Dato label="Emitida a">{c.customerRuc ?? "—"}</Dato>
        {c.description && <Dato label="Concepto" ancho="sm:col-span-3">{c.description}</Dato>}
      </dl>
      {correo.detail && (
        <p className="flex items-start gap-2 border-t border-amber-200 bg-brand-soft px-4 py-2.5 text-sm text-ink-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          <span>{correo.detail}</span>
        </p>
      )}
    </div>
  );
}

/** El correo del que salió, y lo que venía adjunto. */
export function DatosCorreo({ correo }: { correo: CorreoParaDecidir }) {
  return (
    <div className="grid gap-2 text-sm">
      <p className="text-steel-600">
        <span className="text-steel-500">De:</span>{" "}
        <strong className="text-ink">{correo.fromName ?? correo.fromAddress ?? "Remitente desconocido"}</strong>
        {correo.fromName && correo.fromAddress && <span className="text-steel-500"> · {correo.fromAddress}</span>}
      </p>
      <p className="text-steel-600"><span className="text-steel-500">Asunto:</span> {correo.subject ?? "(sin asunto)"}</p>
      <p className="text-steel-500">Recibido el {formatDateTime(correo.receivedAt)}</p>
      {correo.archivos.length > 0 && (
        <ul className="grid gap-1 pt-1">
          {correo.archivos.map((a) => (
            <li key={a.id}>
              <a
                href={`/api/facturas/adjuntos/${a.id}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-steel-700 hover:text-ink hover:underline"
              >
                <FileText className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate">{a.filename}</span>
                <span className="shrink-0 text-xs text-steel-400">{formatFileSize(a.sizeBytes)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Ver el comprobante sin decidir nada. Sirve también para los ya resueltos.
 *
 * No usa el modal de formulario porque aquí no hay nada que guardar: con aquel, cerrar
 * habría sido "enviar" y habría aparecido el aviso verde de siempre sin que nadie hiciera
 * nada.
 */
export function VerComprobanteModal({ correo }: { correo: CorreoParaDecidir }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setAbierto(true)} title="Ver el comprobante">
        <Eye className="h-4 w-4" /><span className="sr-only 2xl:not-sr-only">Ver</span>
      </Button>
      <Modal
        open={abierto}
        onClose={() => setAbierto(false)}
        title={etiquetaComprobante(correo.comprobante) ?? "Correo recibido"}
        description="Lo que mandó el proveedor."
        size="lg"
        footer={<Button variant="outline" onClick={() => setAbierto(false)}>Cerrar</Button>}
      >
        <div className="grid gap-4">
          <DatosComprobante correo={correo} />
          <ResumenMonto correo={correo} />
          <DatosCorreo correo={correo} />
          {correo.status === "RECHAZADO" && <ResumenRechazo correo={correo} />}
          {correo.decidedByName && correo.status === "PROCESADO" && (
            <p className="text-xs text-steel-500">
              Aceptado por {correo.decidedByName}{correo.decidedAt ? ` el ${formatDateTime(correo.decidedAt)}` : ""}.
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}

/**
 * En qué quedó el filtro del monto.
 *
 * Se muestra en la ficha del comprobante porque es la primera pregunta de quien lo abre:
 * si lo que cobran es lo que se pactó. Mientras nadie lo haya verificado, lo dice.
 */
export function ResumenMonto({ correo }: { correo: CorreoParaDecidir }) {
  const c = correo.comprobante;
  if (!c || c.docType === "NOTA_CREDITO") return null;
  const { estado, pactado, nota } = correo.monto;

  if (estado === "PENDIENTE" || !pactado) {
    return (
      <p className="rounded-lg border border-steel-200 bg-steel-50 px-4 py-3 text-sm text-steel-600">
        El monto todavía no se verificó contra lo pactado por el flete. Hasta que eso pase, el
        comprobante no se puede aceptar.
      </p>
    );
  }

  const { diferencia, coincide, cobraDeMas } = compararMonto(c.total, pactado);
  const observado = estado === "OBSERVADO";
  return (
    <div className={cn(
      "grid gap-1 rounded-lg border px-4 py-3 text-sm",
      observado ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50",
    )}>
      <p className={cn("font-semibold", observado ? "text-red-800" : "text-emerald-800")}>
        {AMOUNT_CHECK_LABEL[estado]}
      </p>
      <p className="text-ink-800">
        Facturado {formatMoney(c.total, c.currency)} · pactado {formatMoney(pactado, c.currency)}
        {!coincide && (
          <> · cobra <strong>{formatMoney(Math.abs(diferencia).toFixed(2), c.currency)}</strong>{" "}
            {cobraDeMas ? "de más" : "de menos"}</>
        )}
      </p>
      {nota && <p className="text-steel-700">{nota}</p>}
      {correo.monto.verificadoEl && (
        <p className="text-xs text-steel-600">Verificado el {formatDateTime(correo.monto.verificadoEl)}.</p>
      )}
    </div>
  );
}

/** Cómo quedó un rechazo: el motivo, lo que se escribió y si el aviso llegó a salir. */
export function ResumenRechazo({ correo }: { correo: CorreoParaDecidir }) {
  const motivo = REJECT_REASON_LABEL[correo.rejectReason as RejectReasonKey] ?? correo.rejectReason;
  return (
    <div className="grid gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm">
      <p className="font-semibold text-red-800">Rechazado{motivo ? `: ${motivo}` : ""}</p>
      {correo.rejectComment && <p className="text-ink-800">{correo.rejectComment}</p>}
      <p className="text-xs text-steel-600">
        {correo.decidedByName ?? "Alguien"}
        {correo.decidedAt ? `, ${formatDateTime(correo.decidedAt)}` : ""}
      </p>
      {correo.replySentAt ? (
        <p className="flex items-center gap-1.5 text-xs text-emerald-700">
          <Mail className="h-3.5 w-3.5" aria-hidden /> Se le avisó a {correo.replyTo} el {formatDateTime(correo.replySentAt)}.
        </p>
      ) : (
        <p className="flex items-start gap-1.5 text-xs font-medium text-red-700">
          <MailX className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            {correo.replyError
              ? `El aviso al proveedor no salió: ${correo.replyError}`
              : "No se le envió aviso al proveedor."}
          </span>
        </p>
      )}
    </div>
  );
}

/**
 * Aceptar el comprobante.
 *
 * Los datos no se editan aquí: son los del XML firmado y electrónicamente valen eso. Lo
 * único que se elige es la condición de pago, que no viene en el comprobante porque la
 * pacta la empresa, no el proveedor.
 */
/**
 * El filtro del monto: el primer par de ojos sobre el comprobante.
 *
 * Quien revisa escribe lo que se pactó por el flete y la ventana dice en el acto si
 * coincide, y por cuánto no. Es a propósito que el número se escriba a mano: lo pactado
 * vive en el trato con el proveedor, no en el sistema, y pedir que alguien lo ponga por
 * escrito es justo lo que convierte una comprobación mental en una comprobación.
 *
 * Mientras esto no quede conforme, el comprobante no se puede aceptar.
 */
export function VerificarMontoModal({ correo }: { correo: CorreoParaDecidir }) {
  const c = correo.comprobante;
  const [pactado, setPactado] = useState(correo.monto.pactado ?? "");
  const [nota, setNota] = useState(correo.monto.nota ?? "");
  const [aprobar, setAprobar] = useState(false);

  const escrito = pactado.trim() !== "" && !Number.isNaN(Number(pactado));
  const comparacion = escrito && c ? compararMonto(c.total, pactado) : null;
  const hayDiferencia = !!comparacion && !comparacion.coincide;
  const observado = correo.monto.estado === "OBSERVADO";

  return (
    <FormModal
      title="Verificar el monto"
      description="Antes de aceptar o rechazar: lo facturado contra lo que se pactó por el flete."
      submitLabel={hayDiferencia && !aprobar ? "Dejar el monto observado" : "Guardar la verificación"}
      submitVariant={hayDiferencia && !aprobar ? "danger" : undefined}
      size="sm"
      action={(fd) => verifyEmailAmount(correo.id, fd)}
      trigger={(open) => (
        <Button
          variant={observado ? "outline" : "primary"}
          size="sm"
          onClick={open}
          title="Verificar el monto del flete"
          className={observado ? "text-red-700" : undefined}
        >
          <Scale className="h-4 w-4" />
          <span className="sr-only 2xl:not-sr-only">{observado ? "Revisar monto" : "Verificar monto"}</span>
        </Button>
      )}
    >
      {({ errors }) => (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md border border-steel-200 bg-steel-50 p-3 text-sm">
            <dt className="text-steel-500">Comprobante</dt>
            <dd className="font-medium">{c ? invoiceNumber(c.series, c.number) : (correo.subject ?? "(sin asunto)")}</dd>
            <dt className="text-steel-500">Proveedor</dt>
            <dd className="font-medium">{c?.supplierName ?? correo.fromName ?? "—"}</dd>
            <dt className="text-steel-500">Facturado</dt>
            <dd className="font-display text-base font-bold tabular">
              {c ? formatMoney(c.total, c.currency) : "—"}
            </dd>
          </dl>

          {observado && correo.monto.nota && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
              Quedó observado: {correo.monto.nota}
            </p>
          )}

          <Field
            label="Monto pactado por el flete"
            name="agreedAmount"
            required
            error={errors.agreedAmount}
            hint="Lo acordado con el proveedor, con IGV, tal como debería venir facturado."
          >
            <Input
              name="agreedAmount"
              inputMode="decimal"
              value={pactado}
              onChange={(e) => setPactado(e.target.value)}
              placeholder="2950.00"
              invalid={!!errors.agreedAmount}
              autoFocus
            />
          </Field>

          {/* El veredicto, en el momento: quien revisa no tiene por qué restar de cabeza. */}
          {comparacion && c && (
            comparacion.coincide ? (
              <p className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                Coincide con lo pactado. Al guardar, el comprobante pasa a esperar que lo aceptes o lo rechaces.
              </p>
            ) : (
              <p className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  El proveedor está cobrando{" "}
                  <strong>{formatMoney(Math.abs(comparacion.diferencia).toFixed(2), c.currency)}</strong>{" "}
                  {comparacion.cobraDeMas ? "de más" : "de menos"} de lo pactado.
                </span>
              </p>
            )
          )}

          {hayDiferencia && (
            <label className="flex items-start gap-2 rounded-md border border-steel-200 px-3 py-2.5 text-sm">
              <input
                type="checkbox"
                name="aprobarDiferencia"
                value="true"
                checked={aprobar}
                onChange={(e) => setAprobar(e.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                Aprobar la diferencia igual
                <span className="block text-xs text-steel-500">
                  Úsalo cuando la diferencia tiene explicación —un recargo acordado, una espera, un
                  retorno— y el comprobante se va a pagar así. Sin esto queda observado y no se puede aceptar.
                </span>
              </span>
            </label>
          )}

          <Field
            label={hayDiferencia && aprobar ? "Por qué se aprueba la diferencia" : "Observación"}
            name="amountNote"
            required={hayDiferencia && aprobar}
            error={errors.amountNote}
            hint={hayDiferencia && !aprobar
              ? "Qué hay que reclamarle al proveedor. Lo verá quien retome este comprobante."
              : undefined}
          >
            <Textarea
              name="amountNote"
              rows={2}
              maxLength={250}
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder={hayDiferencia
                ? "Se acordó un recargo de S/ 120 por la espera en planta."
                : undefined}
            />
          </Field>
        </>
      )}
    </FormModal>
  );
}

export function AceptarModal({ correo, condicion }: {
  correo: CorreoParaDecidir;
  /** Lo acordado con ese proveedor, si ya está registrado. */
  condicion?: { paymentTerm: PaymentTermKey; termDays: number } | null;
}) {
  // El tipo viene propuesto por lo que dice el concepto, pero lo decide la persona: es
  // justo lo que vino a hacer a esta pantalla.
  const [tipo, setTipo] = useState<InvoiceServiceTypeKey>(correo.pareceTransporte ? "TRANSPORTE" : "SERVICIO");
  const [term, setTerm] = useState<PaymentTermKey>(condicion?.paymentTerm ?? "CONTADO");
  const [termDays, setTermDays] = useState(String(TERM_DAYS_BY_SERVICE_TYPE[correo.pareceTransporte ? "TRANSPORTE" : "SERVICIO"]));

  const cambiarTipo = (valor: InvoiceServiceTypeKey) => {
    setTipo(valor);
    // Al cambiar de transporte a servicio el plazo cambia solo: 15 días contra 1. Dejarlo
    // como estaba sería la forma más fácil de que una factura venza quince días tarde.
    setTerm("CONTADO");
    setTermDays(String(TERM_DAYS_BY_SERVICE_TYPE[valor]));
  };

  const cambiarTerm = (valor: PaymentTermKey) => {
    setTerm(valor);
    setTermDays(String(valor === "CONTADO" ? TERM_DAYS_BY_SERVICE_TYPE[tipo] : DEFAULT_TERM_DAYS.CREDITO));
  };

  const viaje = correo.viaje;

  return (
    <FormModal
      title="Aceptar el comprobante"
      description="Al aceptar se registra como factura por pagar, con los archivos del correo adjuntos."
      submitLabel="Aceptar y registrar"
      size="lg"
      action={(fd) => approveEmail(correo.id, fd)}
      trigger={(open) => (
        <Button size="sm" onClick={open} title="Aceptar el comprobante">
          <Check className="h-4 w-4" /><span className="sr-only 2xl:not-sr-only">Aceptar</span>
        </Button>
      )}
    >
      {({ errors }) => (
        <div className="grid gap-4">
          <DatosComprobante correo={correo} />

          <Field
            label="¿Qué clase de factura es?"
            name="serviceType"
            required
            error={errors.serviceType}
            hint={tipo === "TRANSPORTE"
              ? "Un flete se paga a 15 días de recibida la factura."
              : "Un servicio corriente se paga al contado."}
          >
            <Select name="serviceType" value={tipo} onChange={(e) => cambiarTipo(e.target.value as InvoiceServiceTypeKey)}>
              {Object.entries(INVOICE_SERVICE_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>

          {tipo === "TRANSPORTE" && (
            /* Lo que se pudo leer del concepto del XML. Se muestra para revisarlo, no
               para confiar en ello: lo que entre mal aquí es lo que después no cuadra
               con el control de fletes. */
            <div className="rounded-lg border border-steel-200 p-4">
              <p className="mb-3 text-sm font-semibold text-ink">
                Datos del viaje
                <span className="ml-2 font-normal text-steel-500">
                  {viaje?.leido ? "leídos del concepto · revísalos" : "no se pudieron leer del concepto · complétalos"}
                </span>
              </p>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Fecha del servicio" name="serviceDate" error={errors.serviceDate}>
                  <DateInput name="serviceDate" defaultValue={viaje?.serviceDate ?? ""} invalid={!!errors.serviceDate} />
                </Field>
                <Field label="Placa" name="plate" error={errors.plate}>
                  <Input name="plate" defaultValue={viaje?.plate ?? ""} maxLength={24} className="uppercase" />
                </Field>
                <Field label="Cliente" name="clientName" error={errors.clientName}>
                  <Input name="clientName" defaultValue={viaje?.clientName ?? ""} maxLength={120} />
                </Field>
                <Field label="Origen" name="originCity" error={errors.originCity}>
                  <Input name="originCity" defaultValue={viaje?.originCity ?? ""} maxLength={80} />
                </Field>
                <Field label="Destino" name="destinationCity" error={errors.destinationCity}>
                  <Input name="destinationCity" defaultValue={viaje?.destinationCity ?? ""} maxLength={120} />
                </Field>
                <Field label="Guía del transportista" name="grtNumber" error={errors.grtNumber}>
                  <Input name="grtNumber" defaultValue={viaje?.grtNumber ?? correo.comprobante?.grtNumber ?? ""} maxLength={40} />
                </Field>
                <Field label="Guía del remitente" name="dispatchNote" error={errors.dispatchNote} className="sm:col-span-3">
                  <Input name="dispatchNote" defaultValue={viaje?.dispatchNote ?? ""} maxLength={40} />
                </Field>
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Condición de pago" name="paymentTerm" required error={errors.paymentTerm}>
              <Select name="paymentTerm" value={term} onChange={(e) => cambiarTerm(e.target.value as PaymentTermKey)}>
                <option value="CONTADO">Contado</option>
                <option value="CREDITO">Crédito</option>
              </Select>
            </Field>
            <Field
              label="Días de plazo"
              name="termDays"
              required
              error={errors.termDays}
              hint={term === "CONTADO" ? "Desde que llegó el correo." : "Desde que llegue la guía en físico."}
            >
              <Input name="termDays" value={termDays} onChange={(e) => setTermDays(e.target.value)} inputMode="numeric" maxLength={3} invalid={!!errors.termDays} />
            </Field>
          </div>

          <Field label="Concepto" name="description" error={errors.description} hint="Lo que viene del comprobante. Cámbialo si no dice gran cosa.">
            <Input name="description" defaultValue={correo.comprobante?.description ?? ""} maxLength={250} />
          </Field>

          <DatosCorreo correo={correo} />
        </div>
      )}
    </FormModal>
  );
}

/**
 * Rechazar el comprobante y devolvérselo al proveedor.
 *
 * El texto del correo se arma solo con el motivo y el comentario, pero se muestra y se
 * puede corregir antes de enviarlo: un correo que sale a nombre de la empresa conviene
 * leerlo entero, y hay proveedores a los que hay que decirles las cosas de otra manera.
 */
/**
 * Aplica a su factura una nota de crédito recibida.
 *
 * Aparece en lugar del botón de aceptar: una nota de crédito no es una factura por pagar,
 * y aceptarla como tal metería en la cola de pagos un comprobante que resta.
 */
export function AplicarNotaCreditoModal({ correo }: { correo: CorreoParaDecidir }) {
  const c = correo.comprobante;
  const factura = c?.referencedDoc;
  return (
    <ConfirmButton
      action={() => applyCreditNoteEmail(correo.id)}
      title="Aplicar la nota de crédito"
      message={factura
        ? `La factura ${factura} quedará anulada con la nota de crédito ${c ? `${c.series}-${c.number}` : ""},`
          + " fuera de lo que hay que pagar y fuera de las detracciones. El XML y el PDF quedan guardados en esa factura."
        : "Esta nota de crédito no dice a qué factura afecta, así que habrá que registrarla a mano desde la factura."}
      confirmLabel="Aplicar y anular la factura"
      confirmVariant="primary"
      triggerVariant="outline"
      triggerLabel={<><FileMinus2 className="h-4 w-4" /><span className="sr-only 2xl:not-sr-only">Aplicar NC</span></>}
      triggerTitle="Aplicar la nota de crédito a su factura"
      disabled={!factura}
    />
  );
}

export function RechazarModal({ correo, empresa }: { correo: CorreoParaDecidir; empresa?: string }) {
  const [motivo, setMotivo] = useState<RejectReasonKey>("DATOS_ERRADOS");
  const [comentario, setComentario] = useState("");
  const [enviar, setEnviar] = useState(true);
  const [texto, setTexto] = useState<string | null>(null);

  const etiqueta = etiquetaComprobante(correo.comprobante);

  // El texto propuesto se recalcula con lo que se va escribiendo; en cuanto la persona lo
  // edita a mano, manda lo suyo y deja de reescribirse solo.
  const propuesto = useMemo(() => rejectionEmailBody({
    comprobante: etiqueta,
    proveedor: correo.comprobante?.supplierName ?? correo.fromName,
    motivo,
    comentario,
    empresa,
  }), [etiqueta, correo.comprobante?.supplierName, correo.fromName, motivo, comentario, empresa]);

  const cuerpo = texto ?? propuesto;

  /**
   * Por defecto se registra solo cuando el proveedor tendrá que emitir la nota de crédito.
   * Un comprobante emitido a otra empresa, o que ya nos habían mandado, no genera ninguna
   * factura nuestra: registrarlo ensuciaría el histórico con algo que nunca fue nuestro.
   */
  const registrarPorDefecto = PIDEN_NOTA_DE_CREDITO.has(motivo) && !!correo.comprobante;
  const [registrar, setRegistrar] = useState(registrarPorDefecto);
  const [tocado, setTocado] = useState(false);
  // Al cambiar el motivo se reajusta la casilla, salvo que la persona ya la haya tocado:
  // su decisión manda sobre la propuesta.
  useEffect(() => {
    if (!tocado) setRegistrar(registrarPorDefecto);
  }, [registrarPorDefecto, tocado]);

  return (
    <FormModal
      title={correo.comprobante ? "Rechazar el comprobante" : "Rechazar el correo"}
      description={correo.comprobante
        ? "Al proveedor le llega la devolución con el motivo, y el motivo queda guardado."
        : "Este correo no trae XML legible. Se devuelve igual: al proveedor le llega el motivo y queda guardado."}
      submitLabel={enviar ? "Rechazar y enviar el correo" : "Rechazar sin avisar"}
      submitVariant="danger"
      size="lg"
      action={(fd) => rejectEmail(correo.id, fd)}
      onClosed={() => setTexto(null)}
      trigger={(open) => (
        <Button variant="outline" size="sm" onClick={open} title={correo.comprobante ? "Rechazar el comprobante" : "Rechazar el correo y avisarle al proveedor"}>
          <X className="h-4 w-4 text-red-600" /><span className="sr-only 2xl:not-sr-only">Rechazar</span>
        </Button>
      )}
    >
      {({ errors }) => (
        <div className="grid gap-4">
          <p className="text-sm text-steel-600">
            {etiqueta ? <>Comprobante <strong className="text-ink">{etiqueta}</strong></> : <>Correo <strong className="text-ink">{correo.subject ?? "(sin asunto)"}</strong></>}
            {correo.comprobante && <> de <strong className="text-ink">{correo.comprobante.supplierName}</strong></>}
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Motivo" name="reason" required error={errors.reason}>
              <Select name="reason" value={motivo} onChange={(e) => setMotivo(e.target.value as RejectReasonKey)}>
                {Object.entries(REJECT_REASON_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Field>
            <Field
              label="Responder a"
              name="replyTo"
              error={errors.replyTo}
              hint="Si se deja vacío, se responde a quien mandó el correo."
            >
              <Input name="replyTo" defaultValue={correo.fromAddress ?? ""} maxLength={250} invalid={!!errors.replyTo} />
            </Field>
          </div>

          <Field
            label="Comentario para el proveedor"
            name="comment"
            error={errors.comment}
            hint="Lo concreto: qué está mal y qué tiene que corregir."
          >
            <Textarea
              name="comment"
              rows={3}
              maxLength={1000}
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              placeholder="El importe no coincide con la cotización aceptada: figuran S/ 1,180 y lo acordado fue S/ 980."
            />
          </Field>

          <Field
            label="Correo que se va a enviar"
            name="body"
            required
            error={errors.body}
            hint="Se arma solo con lo de arriba. Puedes corregirlo antes de enviarlo."
          >
            <Textarea
              name="body"
              rows={12}
              maxLength={4000}
              value={cuerpo}
              onChange={(e) => setTexto(e.target.value)}
              className="text-[13px] leading-relaxed"
            />
          </Field>

          {texto !== null && (
            <button
              type="button"
              onClick={() => setTexto(null)}
              className="justify-self-start text-sm text-steel-600 underline hover:text-ink"
            >
              Volver al texto automático
            </button>
          )}

          <label className="flex items-start gap-2 rounded-md border border-steel-200 px-3 py-2.5 text-sm">
            <input
              type="checkbox"
              name="registrar"
              value="true"
              checked={registrar}
              onChange={(e) => { setRegistrar(e.target.checked); setTocado(true); }}
              className="mt-0.5 h-4 w-4"
              disabled={!correo.comprobante}
            />
            <span>
              Dejar la factura registrada como anulada, esperando la nota de crédito
              <span className="block text-xs text-steel-500">
                {correo.comprobante
                  ? "Esa factura existe ante SUNAT hasta que el proveedor emita la nota de crédito."
                    + " Queda anulada, fuera de lo que hay que pagar y fuera de las detracciones, y en la"
                    + " lista de las que esperan NC para poder reclamársela."
                  : "Este correo no trae los datos del comprobante leídos, así que no hay factura que registrar."}
              </span>
            </span>
          </label>

          <label className="flex items-start gap-2 rounded-md border border-steel-200 px-3 py-2.5 text-sm">
            <input
              type="checkbox"
              name="send"
              value="true"
              checked={enviar}
              onChange={(e) => setEnviar(e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              Enviarle este correo al proveedor
              <span className="block text-xs text-steel-500">
                Sale desde el buzón de facturas, en el mismo hilo en que escribió. Sin esto, el rechazo
                queda solo dentro del sistema y el proveedor no se entera.
              </span>
            </span>
          </label>
        </div>
      )}
    </FormModal>
  );
}
