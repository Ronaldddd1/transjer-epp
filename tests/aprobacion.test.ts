/**
 * Aceptar y rechazar los comprobantes que llegan por correo.
 *
 * Lo que se juega aquí es cuándo nace una deuda. Antes la creaba el buzón solo; ahora la
 * crea una persona al aceptar, así que lo que más se prueba es que aceptar registre
 * exactamente lo que decía el XML, que no se pueda registrar dos veces lo mismo, y que un
 * rechazo deje constancia de si al proveedor se le avisó de verdad o no.
 *
 *   npx tsx --conditions=react-server tests/aprobacion.test.ts
 */
import "dotenv/config";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import {
  auditLogs, invoiceAttachments, invoiceEmails, supplierInvoices, suppliers, users,
} from "../src/db/schema";
import { REJECT_REASON_LABEL, rejectionEmailBody } from "../src/lib/utils";
import { leerConceptoTransporte } from "../src/server/concepto-transporte";
import { parsedOf, registerApprovedEmail, registerRejectedEmail } from "../src/server/invoice-approval";
import { readSmtpConfig } from "../src/server/mailer";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("OK  ", n);
  else { fails++; console.log("FALLA", n, JSON.stringify(x ?? "")); }
};

const SELLO = String(Date.now()).slice(-6);
const RUC = `20${SELLO}000`.slice(0, 11);
const SERIE = "FAP1";

const COMPROBANTE = {
  docType: "FACTURA" as const,
  series: SERIE,
  number: SELLO,
  issueDate: "2026-10-02",
  dueDate: "2026-11-02",
  currency: "PEN" as const,
  subtotal: "1000.00",
  igv: "180.00",
  total: "1180.00",
  supplierRuc: RUC,
  supplierName: `PROVEEDOR DE PRUEBA ${SELLO} S.A.C.`,
  customerRuc: "20555555551",
  description: "Servicio de transporte Lima - Trujillo",
  grtNumber: "T001-999",
};

async function limpiar() {
  await db.delete(invoiceEmails).where(sql`${invoiceEmails.messageId} like 'aprob-%'`);
  const prov = await db.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.ruc, RUC));
  for (const p of prov) {
    await db.delete(supplierInvoices).where(eq(supplierInvoices.supplierId, p.id));
    await db.delete(suppliers).where(eq(suppliers.id, p.id));
  }
}

/** Un correo ya leído, esperando decisión, como lo deja el buzón. */
async function correoPorAprobar(sufijo: string, numero = SELLO) {
  const [email] = await db.insert(invoiceEmails).values({
    messageId: `aprob-${SELLO}-${sufijo}`,
    internetMessageId: `<${sufijo}@proveedor.pe>`,
    subject: `Factura ${SERIE}-${SELLO}`,
    fromAddress: "facturacion@proveedor.pe",
    fromName: "Facturación Proveedor",
    receivedAt: new Date("2026-10-03T14:00:00Z"),
    status: "POR_APROBAR",
    attachmentCount: 2,
    parsed: { ...COMPROBANTE, number: numero },
  }).returning();
  // Los archivos llegan colgando del correo, no de ninguna factura: todavía no existe.
  for (const nombre of ["factura.pdf", "factura.xml"]) {
    await db.insert(invoiceAttachments).values({
      emailId: email.id,
      kind: nombre.endsWith("xml") ? "FACTURA_XML" : "FACTURA_PDF",
      filename: nombre,
      contentType: nombre.endsWith("xml") ? "text/xml" : "application/pdf",
      sizeBytes: 10,
      storageDriver: "db",
      content: Buffer.from("x".repeat(10)),
    });
  }
  return email;
}

async function main() {
  await limpiar();

  const [quien] = await db.select({ id: users.id, name: users.name }).from(users).limit(1);
  if (!quien) throw new Error("Hace falta al menos un usuario en la base para esta prueba.");

  // ---------- Aceptar ----------
  const email = await correoPorAprobar("ok");
  const resultado = await db.transaction((tx) => registerApprovedEmail(tx, email, quien));
  check("aceptar registra la factura", resultado.ok === true, resultado);
  if (!resultado.ok) { console.log(resultado.error); process.exit(1); }

  const [factura] = await db.select().from(supplierInvoices).where(eq(supplierInvoices.id, resultado.invoiceId));
  check("el importe es el del XML, sin tocar", factura?.total === "1180.00", factura?.total);
  check("la fecha de emisión es la del XML", factura?.issueDate === "2026-10-02", factura?.issueDate);
  check("el vencimiento es el del XML", factura?.dueDate === "2026-11-02", factura?.dueDate);
  check("la guía de remisión viaja con la factura", factura?.grtNumber === "T001-999", factura?.grtNumber);
  check("queda pendiente de pago", factura?.status === "PENDIENTE", factura?.status);
  check("queda marcada como venida del correo", factura?.source === "CORREO", factura?.source);
  check("guarda cuándo llegó el correo", !!factura?.receivedAt);

  const [proveedor] = await db.select().from(suppliers).where(eq(suppliers.ruc, RUC));
  check("el proveedor se da de alta recién al aceptar", proveedor?.businessName === COMPROBANTE.supplierName, proveedor?.businessName);

  const adjuntos = await db.select().from(invoiceAttachments)
    .where(eq(invoiceAttachments.invoiceId, resultado.invoiceId));
  check("los archivos del correo pasan a la factura", adjuntos.length === 2, adjuntos.length);
  check("y siguen pudiéndose ver desde el correo",
    adjuntos.every((a) => a.emailId === email.id), adjuntos.map((a) => a.emailId));
  // Si se copiaran en vez de reetiquetarse, el mismo PDF ocuparía el doble en el almacén.
  const [{ n: copias }] = await db.select({ n: sql<number>`count(*)::int` }).from(invoiceAttachments)
    .where(eq(invoiceAttachments.emailId, email.id));
  check("no se duplican los archivos", copias === 2, copias);

  const [actualizado] = await db.select().from(invoiceEmails).where(eq(invoiceEmails.id, email.id));
  check("el correo queda aceptado", actualizado?.status === "PROCESADO", actualizado?.status);
  check("apunta a la factura creada", actualizado?.invoiceId === resultado.invoiceId);
  check("queda quién lo aceptó", actualizado?.decidedBy === quien.id);
  check("y cuándo", !!actualizado?.decidedAt);

  const [registro] = await db.select().from(auditLogs)
    .where(and(eq(auditLogs.module, "CORREO"), eq(auditLogs.recordId, resultado.invoiceId))).limit(1);
  check("la aceptación queda en auditoría con el nombre de quien decidió",
    !!registro && registro.description.includes(quien.name), registro?.description);

  // ---------- Transporte: plazo de 15 días y datos del viaje ----------
  // Un flete no se paga igual que un servicio, y los datos del viaje salen del concepto
  // del XML: si se guardaran mal, el control de fletes dejaría de cuadrar.
  const flete = await correoPorAprobar("flete");
  await db.update(invoiceEmails).set({
    parsed: {
      ...COMPROBANTE,
      number: `${SELLO}9`,
      description: "POR EL SERVICIO DE TRANSPORTE DE CARGA LIMA- LOCAL CON FECHA 13/10/2026 "
        + "S/G/R/T/E VT01-007988 S/G/R/E/T EG03 - 00000349 CLIENTE TIENDAS PERUANAS SA CON PLACA BBR-905",
    },
  }).where(eq(invoiceEmails.id, flete.id));
  const [conViaje] = await db.select().from(invoiceEmails).where(eq(invoiceEmails.id, flete.id));

  const leido = leerConceptoTransporte(parsedOf(conViaje)?.description);
  const aceptadoFlete = await db.transaction((tx) => registerApprovedEmail(tx, conViaje, quien, {
    serviceType: "TRANSPORTE",
    viaje: leido,
  }));
  check("un flete se acepta igual", aceptadoFlete.ok === true, aceptadoFlete);
  if (aceptadoFlete.ok) {
    const [transporte] = await db.select().from(supplierInvoices).where(eq(supplierInvoices.id, aceptadoFlete.invoiceId));
    check("queda marcada como factura de transporte", transporte?.serviceType === "TRANSPORTE", transporte?.serviceType);
    check("con 15 días de plazo", transporte?.termDays === 15, transporte?.termDays);
    check("la placa sale del concepto", transporte?.plate === "BBR-905", transporte?.plate);
    check("el cliente también", transporte?.clientName === "TIENDAS PERUANAS SA", transporte?.clientName);
    check("y el destino", transporte?.destinationCity === "LOCAL", transporte?.destinationCity);
    check("la fecha del servicio es la del concepto, no la del correo",
      transporte?.serviceDate === "2026-10-13", transporte?.serviceDate);
    check("la guía del transportista se guarda aparte de la del remitente",
      transporte?.grtNumber === "VT01-007988" && transporte?.dispatchNote === "EG03-00000349", transporte);

    // El correo llegó el 3 de octubre: 15 días después es el 18.
    check("la fecha límite se cuenta desde que llegó el correo",
      transporte?.payDueDate === "2026-10-18", transporte?.payDueDate);
  }

  // Un servicio corriente, en cambio, vence al día siguiente y no lleva datos de viaje.
  const servicio = await correoPorAprobar("servicio");
  await db.update(invoiceEmails).set({ parsed: { ...COMPROBANTE, number: `${SELLO}8` } })
    .where(eq(invoiceEmails.id, servicio.id));
  const [soloServicio] = await db.select().from(invoiceEmails).where(eq(invoiceEmails.id, servicio.id));
  const aceptadoServicio = await db.transaction((tx) => registerApprovedEmail(tx, soloServicio, quien, {
    serviceType: "SERVICIO",
  }));
  if (aceptadoServicio.ok) {
    const [serv] = await db.select().from(supplierInvoices).where(eq(supplierInvoices.id, aceptadoServicio.invoiceId));
    check("un servicio queda con 1 día de plazo", serv?.termDays === 1, serv?.termDays);
    check("y sin datos de viaje", !serv?.plate && !serv?.clientName, serv);
  }

  // ---------- No se registra dos veces lo mismo ----------
  // El mismo comprobante llega otra vez (reenvío del proveedor) y alguien intenta
  // aceptarlo: ya existe la factura, así que no debe nacer una segunda.
  const repetido = await correoPorAprobar("repe");
  const segundo = await db.transaction((tx) => registerApprovedEmail(tx, repetido, quien));
  check("un comprobante ya registrado no se acepta de nuevo", segundo.ok === false, segundo);
  const [{ n: cuantas }] = await db.select({ n: sql<number>`count(*)::int` }).from(supplierInvoices)
    .where(and(eq(supplierInvoices.series, SERIE), eq(supplierInvoices.number, SELLO)));
  check("sigue habiendo una sola factura", cuantas === 1, cuantas);
  const [repetidoFinal] = await db.select().from(invoiceEmails).where(eq(invoiceEmails.id, repetido.id));
  check("el reenvío queda descartado, no colgado", repetidoFinal?.status === "DESCARTADO", repetidoFinal?.status);

  // ---------- Un correo sin datos leídos no se puede aceptar ----------
  const [sinDatos] = await db.insert(invoiceEmails).values({
    messageId: `aprob-${SELLO}-vacio`,
    subject: "Correo sin XML",
    receivedAt: new Date(),
    status: "POR_APROBAR",
  }).returning();
  const nada = await db.transaction((tx) => registerApprovedEmail(tx, sinDatos, quien));
  check("sin datos del comprobante no se registra nada", nada.ok === false, nada);

  // ---------- El estado es cerrado ----------
  let motivo = "NO FALLÓ";
  try {
    await db.insert(invoiceEmails).values({
      messageId: `aprob-${SELLO}-malo`, receivedAt: new Date(),
      status: "INVENTADO" as never,
    });
  } catch (e) {
    const causa = (e as { cause?: { constraint_name?: string } })?.cause;
    motivo = causa?.constraint_name ?? "otro error";
  }
  check("la base no acepta un estado inventado", motivo.includes("status_valid"), motivo);

  // ---------- El correo de rechazo ----------
  const texto = rejectionEmailBody({
    comprobante: `${SERIE}-${SELLO}`,
    proveedor: COMPROBANTE.supplierName,
    motivo: "IMPORTE",
    comentario: "Figuran S/ 1,180 y lo acordado fue S/ 980.",
  });
  check("el correo nombra al proveedor", texto.includes(COMPROBANTE.supplierName), texto.slice(0, 60));
  check("dice de qué comprobante se trata", texto.includes(`${SERIE}-${SELLO}`));
  check("dice el motivo en palabras, no en clave", texto.includes(REJECT_REASON_LABEL.IMPORTE));
  check("incluye el comentario escrito a mano", texto.includes("lo acordado fue S/ 980"));
  check("pide que lo corrijan y lo reenvíen", texto.toLowerCase().includes("volver a enviarlo"));
  check("separa los párrafos", texto.includes("\n\n"));
  check("no quedan líneas en blanco de más", !texto.includes("\n\n\n"), texto);

  const sinComentario = rejectionEmailBody({
    comprobante: null, proveedor: null, motivo: "FALTA_GRT", comentario: "   ",
  });
  check("sin comentario el correo igual se entiende",
    sinComentario.includes("Estimados señores:") && sinComentario.includes(REJECT_REASON_LABEL.FALTA_GRT), sinComentario);
  check("y tampoco deja huecos", !sinComentario.includes("\n\n\n"), sinComentario);

  const motivoRaro = rejectionEmailBody({ comprobante: "F001-1", proveedor: "X", motivo: "LO_QUE_SEA", comentario: "" });
  check("un motivo desconocido no rompe el correo", motivoRaro.includes("Otro motivo"), motivoRaro);

  // ---------- El correo de salida ----------
  // Sale del mismo buzón que recibe: en un correo corriente el servidor de salida es el
  // mismo que el de entrada, y pedir configurarlo aparte sería pedir lo mismo dos veces.
  const antes = { ...process.env };
  try {
    Object.assign(process.env, {
      IMAP_HOST: "mail.ejemplo.com", IMAP_USER: "facturas@ejemplo.com", IMAP_PASSWORD: "x",
      SMTP_HOST: "", SMTP_PORT: "", SMTP_USER: "", SMTP_PASSWORD: "", MAIL_FROM: "", MAIL_FROM_NAME: "",
    });
    let smtp = readSmtpConfig();
    check("el envío hereda el servidor del buzón", smtp?.host === "mail.ejemplo.com", smtp);
    check("y su usuario", smtp?.user === "facturas@ejemplo.com", smtp?.user);
    check("por defecto usa el puerto cifrado 465", smtp?.port === 465 && smtp?.secure === true, smtp);
    check("y responde desde la misma dirección", smtp?.from === "facturas@ejemplo.com", smtp?.from);

    process.env.SMTP_PORT = "587";
    smtp = readSmtpConfig();
    check("en el puerto 587 el cifrado arranca después", smtp?.port === 587 && smtp?.secure === false, smtp);

    process.env.SMTP_HOST = "smtp.otro.com";
    process.env.SMTP_USER = "avisos@otro.com";
    process.env.SMTP_PASSWORD = "y";
    smtp = readSmtpConfig();
    check("si se configura un servidor de salida aparte, manda ese",
      smtp?.host === "smtp.otro.com" && smtp?.user === "avisos@otro.com", smtp);

    process.env.IMAP_PASSWORD = "";
    process.env.SMTP_PASSWORD = "";
    check("sin contraseña no se intenta enviar nada", readSmtpConfig() === null);
  } finally {
    for (const k of ["IMAP_HOST", "IMAP_USER", "IMAP_PASSWORD", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "MAIL_FROM", "MAIL_FROM_NAME"]) {
      if (antes[k] === undefined) delete process.env[k];
      else process.env[k] = antes[k];
    }
  }

  // ---------- Rechazar dejando la factura anulada ----------
  /**
   * Es el caso que parece contradictorio: se registra lo que se acaba de rechazar. La
   * factura existe ante SUNAT hasta que llegue la nota de crédito, y si aquí no queda
   * rastro, dentro de tres meses nadie sabe por qué falta ese número.
   */
  const rechazado = await correoPorAprobar("rech", `${SELLO}9`);
  const reg = await db.transaction((tx) => registerRejectedEmail(tx, rechazado, quien, {
    reason: "IMPORTE", comment: "Se pactaron S/ 980.",
  }));
  check("rechazar puede dejar la factura registrada", reg.ok === true, reg);

  if (reg.ok) {
    const [anulada] = await db.select().from(supplierInvoices)
      .where(eq(supplierInvoices.id, reg.invoiceId));
    check("la factura del rechazo queda anulada", anulada.status === "ANULADA", anulada.status);
    check("y marcada como que espera la nota de crédito", anulada.awaitingCreditNote === true);
    check("el motivo del rechazo queda escrito en la factura",
      (anulada.statusReason ?? "").includes("importe") || (anulada.statusReason ?? "").includes("Se pactaron"),
      anulada.statusReason);
    check("no genera detracción, porque no se va a pagar", anulada.detractionStatus === "NO_APLICA");
    check("y no entra en la cola de pagos: no tiene fecha límite", anulada.payDueDate === null, { payDueDate: anulada.payDueDate, term: anulada.paymentTerm, dias: anulada.termDays });

    const [correoTrasRechazo] = await db.select().from(invoiceEmails)
      .where(eq(invoiceEmails.id, rechazado.id));
    check("el correo queda enlazado con esa factura", correoTrasRechazo.invoiceId === reg.invoiceId);

    const adjuntos = await db.select().from(invoiceAttachments)
      .where(eq(invoiceAttachments.invoiceId, reg.invoiceId));
    check("los archivos del correo pasan a la factura, para poder enseñarlos",
      adjuntos.length === 2, adjuntos.length);

    /**
     * Y si la factura YA estaba registrada cuando se rechaza, se anula la que hay en vez
     * de duplicarla, y se le quita la fecha límite: una factura devuelta que conserva su
     * vencimiento sigue saliendo en el calendario de pagos reclamando lo que ya no se paga.
     */
    const yaRegistrada = await correoPorAprobar("rech2");
    const segundo = await db.transaction((tx) => registerRejectedEmail(tx, yaRegistrada, quien, {
      reason: "DATOS_ERRADOS", comment: null,
    }));
    check("rechazar una factura ya registrada no la duplica",
      segundo.ok === true && segundo.invoiceId === resultado.invoiceId, segundo);
    if (segundo.ok) {
      const [reanulada] = await db.select().from(supplierInvoices)
        .where(eq(supplierInvoices.id, segundo.invoiceId));
      check("la que ya estaba registrada queda anulada", reanulada.status === "ANULADA");
      check("y pierde su fecha límite de pago", reanulada.payDueDate === null, reanulada.payDueDate);
    }

    // ---------- Y cuando llega la nota de crédito, se cierra ----------
    await db.update(supplierInvoices).set({
      creditNoteNumber: "NC-01",
      creditNoteDate: "2026-10-20",
      creditNoteAmount: anulada.total,
      awaitingCreditNote: false,
    }).where(eq(supplierInvoices.id, reg.invoiceId));

    const [cerrada] = await db.select().from(supplierInvoices)
      .where(eq(supplierInvoices.id, reg.invoiceId));
    check("con la nota registrada deja de esperarla", cerrada.awaitingCreditNote === false);
    check("y sigue anulada, ahora con su nota al lado",
      cerrada.status === "ANULADA" && cerrada.creditNoteNumber === "NC-01");
  }

  await limpiar();
  console.log(fails === 0 ? "\nAPROBACIÓN: todo en orden." : `\n${fails} comprobación(es) fallaron.`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
