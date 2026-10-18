"use client";

import { AlertTriangle, Check, Eye, FileText, Mail, MailX, X } from "lucide-react";
import { useMemo, useState } from "react";
import { approveEmail, rejectEmail } from "@/actions/mailbox";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormModal } from "@/components/ui/form-modal";
import { Modal } from "@/components/ui/modal";
import {
  DEFAULT_TERM_DAYS, formatDate, formatDateTime, formatFileSize, formatMoney,
  INVOICE_DOC_TYPE_LABEL, invoiceNumber, REJECT_REASON_LABEL, rejectionEmailBody,
  type PaymentTermKey, type RejectReasonKey,
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
  rejectReason: string | null;
  rejectComment: string | null;
  replyTo: string | null;
  replySentAt: string | null;
  replyError: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
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
export function AceptarModal({ correo, condicion }: {
  correo: CorreoParaDecidir;
  /** Lo acordado con ese proveedor, si ya está registrado. */
  condicion?: { paymentTerm: PaymentTermKey; termDays: number } | null;
}) {
  const [term, setTerm] = useState<PaymentTermKey>(condicion?.paymentTerm ?? "CONTADO");
  const [termDays, setTermDays] = useState(String(condicion?.termDays ?? DEFAULT_TERM_DAYS.CONTADO));

  const cambiarTerm = (valor: PaymentTermKey) => {
    setTerm(valor);
    setTermDays(String(DEFAULT_TERM_DAYS[valor]));
  };

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

  return (
    <FormModal
      title="Rechazar el comprobante"
      description="No se registra nada, y al proveedor le llega la devolución con el motivo."
      submitLabel={enviar ? "Rechazar y enviar el correo" : "Rechazar sin avisar"}
      submitVariant="danger"
      size="lg"
      action={(fd) => rejectEmail(correo.id, fd)}
      onClosed={() => setTexto(null)}
      trigger={(open) => (
        <Button variant="outline" size="sm" onClick={open} title="Rechazar el comprobante">
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
