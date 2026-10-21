import "server-only";
import {
  ATTACHMENT_KIND_LABEL, DETRACTION_STATUS_LABEL, formatDate, formatDateTime, INSTALLMENT_STATUS_LABEL,
  INVOICE_DOC_TYPE_LABEL, INVOICE_SERVICE_TYPE_LABEL, INVOICE_SOURCE_LABEL, INVOICE_STATUS_LABEL, invoiceNumber,
  EMAIL_STATUS_LABEL, monthEnd, monthStart, MOVEMENT_LABEL, OBLIGATION_STATUS_LABEL, OBLIGATION_TYPE_LABEL,
  PAYMENT_TERM_LABEL, REJECT_REASON_LABEL, RETURN_CONDITION_LABEL, ROLE_EXPORT_LABEL,
  DOCUMENT_STATUS_LABEL, documentStatus, exigeRevisionTecnica, FLEET_STATUS_LABEL,
  MAINTENANCE_KIND_LABEL, MAINTENANCE_STATUS_LABEL,
  STOCK_STATUS_LABEL, stockStatus,
  type RejectReasonKey, type SearchParamsRecord,
} from "@/lib/utils";
import type { Permission } from "@/lib/permissions";
import {
  deliverySummary, listAudit, listCategories, listDeliveries, listEmployees, listMovements,
  listPendingReturns, listProducts, listReturns, listUsers, readFilters,
} from "./queries";
import {
  getInvoice, listInvoiceEmails, listInvoices, listSuppliers, readEmailFilters, readInvoiceFilters,
} from "./invoice-queries";
import { estadoFlota, listFleet } from "./document-queries";
import { listMaintenance, readMaintenanceFilters } from "./maintenance-queries";
import { listInstallments, listObligations, listPaymentCalendar, readObligationFilters } from "./obligation-queries";
import type { Report } from "./reports";

/**
 * Exportar a Excel cualquier tabla del sistema.
 *
 * Cada entrada toma los mismos filtros que la pantalla de la que sale, así que lo que se
 * descarga es exactamente lo que se está viendo, no la tabla entera. Las pantallas con más
 * de una tabla devuelven varias, y el Excel sale con una hoja por cada una.
 */

export type TableExport = {
  /** Cómo se llama el archivo y qué dice la cabecera del Excel. */
  title: string;
  permission: Permission;
  build: (sp: SearchParamsRecord) => Promise<Report[]>;
};

const money = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? "" : Number(v));
const texto = (v: string | null | undefined) => v ?? "";
const fecha = (v: string | Date | null | undefined) => (v ? formatDate(typeof v === "string" ? v : v.toISOString().slice(0, 10)) : "");

export const TABLE_EXPORTS: Record<string, TableExport> = {
  // ---------- Facturas de proveedores ----------
  facturas: {
    title: "Facturas de proveedores",
    permission: "invoices.view",
    async build(sp) {
      const { rows } = await listInvoices(readInvoiceFilters(sp), 5000, 0);
      return [{
        title: "Facturas de proveedores",
        columns: [
          { key: "comprobante", header: "Comprobante", width: 14 },
          { key: "tipo", header: "Tipo", width: 12 },
          { key: "clase", header: "Transporte o servicio", width: 18 },
          { key: "proveedor", header: "Proveedor", width: 30 },
          { key: "ruc", header: "RUC", width: 13 },
          { key: "emision", header: "Emisión", width: 11 },
          { key: "llegada", header: "Llegó el correo", width: 13 },
          { key: "condicion", header: "Condición", width: 11 },
          { key: "guia", header: "Guía entregada", width: 13 },
          { key: "vence", header: "Vence", width: 11 },
          { key: "cliente", header: "Cliente", width: 16 },
          { key: "placa", header: "Placa", width: 12 },
          { key: "origen", header: "Origen", width: 14 },
          { key: "destino", header: "Destino", width: 18 },
          { key: "m3", header: "m³", width: 7, align: "right" },
          { key: "tn", header: "Toneladas", width: 10, align: "right" },
          { key: "moneda", header: "Moneda", width: 8 },
          { key: "subtotal", header: "Base imponible", width: 13, align: "right" },
          { key: "igv", header: "IGV", width: 11, align: "right" },
          { key: "total", header: "Total", width: 13, align: "right" },
          { key: "detraccion", header: "Detracción", width: 11, align: "right" },
          { key: "neto", header: "A pagar al proveedor", width: 15, align: "right" },
          { key: "adelantos", header: "Adelantos", width: 11, align: "right" },
          { key: "saldo", header: "Saldo", width: 11, align: "right" },
          { key: "estado", header: "Estado de pago", width: 15 },
          { key: "pago", header: "Fecha de pago", width: 12 },
          { key: "detraccionEstado", header: "Estado detracción", width: 15 },
          { key: "constancia", header: "N.º constancia", width: 14 },
          { key: "grt", header: "Guía del transportista", width: 16 },
          { key: "guiaRemitente", header: "Guía del remitente", width: 16 },
          { key: "contacto", header: "Contacto", width: 18 },
          { key: "origenRegistro", header: "Origen del registro", width: 15 },
          { key: "concepto", header: "Concepto", width: 30 },
        ],
        rows: rows.map((i) => {
          const detraccion = Number(i.detractionAmount ?? 0);
          const neto = Number(i.total) - detraccion;
          return {
            comprobante: invoiceNumber(i.series, i.number),
            tipo: INVOICE_DOC_TYPE_LABEL[i.docType],
            clase: i.serviceType ? INVOICE_SERVICE_TYPE_LABEL[i.serviceType] : "sin clasificar",
            proveedor: i.supplierName,
            ruc: i.supplierRuc ?? "pendiente",
            emision: fecha(i.issueDate),
            llegada: fecha(i.receptionDate),
            condicion: `${PAYMENT_TERM_LABEL[i.paymentTerm]} · ${i.termDays} d`,
            guia: fecha(i.guideReceivedAt),
            vence: i.payDueDate ? fecha(i.payDueDate) : "esperando la guía",
            cliente: texto(i.clientName),
            placa: texto(i.plate),
            origen: texto(i.originCity),
            destino: texto(i.destinationCity),
            m3: money(i.volumeM3),
            tn: money(i.weightTn),
            moneda: i.currency,
            subtotal: money(i.subtotal),
            igv: money(i.igv),
            total: money(i.total),
            detraccion: detraccion || "",
            neto: Math.round(neto * 100) / 100,
            adelantos: money(i.advances),
            saldo: Math.round((neto - Number(i.advances ?? 0)) * 100) / 100,
            estado: INVOICE_STATUS_LABEL[i.status],
            pago: fecha(i.paidAt),
            detraccionEstado: DETRACTION_STATUS_LABEL[i.detractionStatus],
            constancia: texto(i.detractionReceipt),
            grt: texto(i.grtNumber),
            guiaRemitente: texto(i.dispatchNote),
            contacto: texto(i.contactName),
            origenRegistro: INVOICE_SOURCE_LABEL[i.source],
            concepto: texto(i.description),
          };
        }),
        summary: [
          { label: "Facturas", value: rows.length },
          { label: "Pendientes", value: rows.filter((i) => i.status === "PENDIENTE").length },
        ],
      }];
    },
  },

  // ---------- Detracciones ----------
  detracciones: {
    title: "Detracciones",
    permission: "detractions.view",
    async build(sp) {
      const f = readInvoiceFilters(sp);
      // La pantalla muestra solo las pendientes mientras nadie elija un estado, y "ver todas"
      // es el parámetro presente pero vacío. El archivo tiene que salir igual que la pantalla,
      // así que se distingue entre que falte el parámetro y que esté vacío a propósito.
      const sinElegir = !("detraccion" in sp);
      const { rows } = await listInvoices(sinElegir ? { ...f, detraction: "PENDIENTE" } : f, 5000, 0);
      const importe = (i: (typeof rows)[number]) => Number(i.detractionAmount ?? 0);
      return [{
        title: "Detracciones",
        columns: [
          { key: "comprobante", header: "Comprobante", width: 14 },
          { key: "proveedor", header: "Proveedor", width: 32 },
          { key: "ruc", header: "RUC", width: 13 },
          { key: "cliente", header: "Cliente", width: 16 },
          { key: "emision", header: "Emisión factura", width: 13 },
          { key: "moneda", header: "Moneda", width: 8 },
          { key: "total", header: "Importe de la factura", width: 16, align: "right" },
          { key: "tasa", header: "Tasa", width: 7, align: "right" },
          { key: "monto", header: "Detracción", width: 12, align: "right" },
          { key: "estado", header: "Estado", width: 13 },
          { key: "deposito", header: "Fecha del depósito", width: 15 },
          { key: "constancia", header: "N.º constancia", width: 15 },
          { key: "operacion", header: "N.º operación", width: 14 },
          { key: "observaciones", header: "Observaciones", width: 36 },
        ],
        rows: rows.map((i) => ({
          comprobante: invoiceNumber(i.series, i.number),
          proveedor: i.supplierName,
          ruc: i.supplierRuc ?? "pendiente",
          cliente: texto(i.clientName),
          emision: fecha(i.issueDate),
          moneda: i.currency,
          total: money(i.total),
          tasa: `${Number(i.detractionRate)} %`,
          monto: importe(i) || "",
          estado: DETRACTION_STATUS_LABEL[i.detractionStatus],
          deposito: fecha(i.detractionPaidAt),
          constancia: texto(i.detractionReceipt),
          operacion: texto(i.detractionOperation),
          observaciones: texto(i.detractionNotes),
        })),
        summary: [
          { label: "Facturas", value: rows.length },
          { label: "Total a depositar", value: Math.round(rows.reduce((s, i) => s + importe(i), 0) * 100) / 100 },
        ],
      }];
    },
  },

  // ---------- Proveedores ----------
  proveedores: {
    title: "Proveedores",
    permission: "suppliers.manage",
    async build(sp) {
      // El Excel sale con los mismos filtros que la pantalla: si se miró un destino o un
      // rango de fechas, el archivo trae eso y no todo.
      const texto1 = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : undefined);
      const { rows } = await listSuppliers(
        { q: texto1("q"), from: texto1("from"), to: texto1("to"), destino: texto1("destino") },
        5000, 0,
      );
      return [{
        title: "Proveedores",
        columns: [
          { key: "razon", header: "Razón social", width: 34 },
          { key: "ruc", header: "RUC", width: 13 },
          { key: "comercial", header: "Nombre comercial", width: 24 },
          { key: "contacto", header: "Contacto", width: 20 },
          { key: "correo", header: "Correo", width: 26 },
          { key: "telefono", header: "Teléfono", width: 14 },
          { key: "condicion", header: "Condición pactada", width: 16 },
          { key: "plazo", header: "Días de plazo", width: 12, align: "right" },
          { key: "facturas", header: "Facturas", width: 10, align: "right" },
          { key: "pendientes", header: "Facturas pendientes", width: 13, align: "right" },
          { key: "pendienteSoles", header: "Pendiente S/", width: 14, align: "right" },
          { key: "pendienteDolares", header: "Pendiente US$", width: 14, align: "right" },
          { key: "pagadas", header: "Facturas pagadas", width: 13, align: "right" },
          { key: "pagadoSoles", header: "Pagado S/", width: 14, align: "right" },
          { key: "pagadoDolares", header: "Pagado US$", width: 14, align: "right" },
          { key: "estado", header: "Estado", width: 10 },
          { key: "observaciones", header: "Observaciones", width: 34 },
        ],
        rows: rows.map((s) => ({
          razon: s.businessName,
          ruc: s.ruc ?? "pendiente",
          comercial: texto(s.tradeName),
          contacto: texto(s.contactName),
          correo: texto(s.email),
          telefono: texto(s.phone),
          condicion: PAYMENT_TERM_LABEL[s.defaultPaymentTerm],
          plazo: s.defaultTermDays,
          facturas: s.invoiceCount,
          pendientes: s.pendingCount,
          // Sin la detracción: es lo que de verdad se le transfiere al proveedor.
          pendienteSoles: money(s.pendingPen),
          pendienteDolares: money(s.pendingUsd),
          pagadas: s.paidCount,
          pagadoSoles: money(s.paidPen),
          pagadoDolares: money(s.paidUsd),
          estado: s.active ? "Activo" : "Inactivo",
          observaciones: texto(s.notes),
        })),
        summary: [
          { label: "Proveedores", value: rows.length },
          { label: "Sin RUC", value: rows.filter((s) => !s.ruc).length },
          { label: "Pendiente S/", value: Number(rows.reduce((t, s) => t + Number(s.pendingPen), 0).toFixed(2)) },
          { label: "Pagado S/", value: Number(rows.reduce((t, s) => t + Number(s.paidPen), 0).toFixed(2)) },
        ],
      }];
    },
  },

  // ---------- Préstamos y servicios ----------
  obligaciones: {
    title: "Préstamos y servicios",
    permission: "obligations.view",
    async build(sp) {
      const rows = await listObligations(readObligationFilters(sp));
      return [{
        title: "Préstamos y servicios",
        columns: [
          { key: "nombre", header: "Obligación", width: 32 },
          { key: "tipo", header: "Tipo", width: 12 },
          { key: "entidad", header: "Entidad", width: 20 },
          { key: "referencia", header: "N.º de crédito", width: 24 },
          { key: "moneda", header: "Moneda", width: 8 },
          { key: "capital", header: "Capital", width: 13, align: "right" },
          { key: "tasa", header: "TEA", width: 8, align: "right" },
          { key: "desembolso", header: "Desembolso", width: 12 },
          { key: "cuotas", header: "Cuotas", width: 9, align: "right" },
          { key: "pagadas", header: "Pagadas", width: 9, align: "right" },
          { key: "pendientes", header: "Pendientes", width: 11, align: "right" },
          { key: "vencidas", header: "Vencidas", width: 10, align: "right" },
          { key: "falta", header: "Falta pagar", width: 13, align: "right" },
          { key: "saldo", header: "Saldo de capital", width: 14, align: "right" },
          { key: "proxima", header: "Próxima cuota", width: 13 },
          { key: "importeProxima", header: "Importe próxima", width: 14, align: "right" },
          { key: "estado", header: "Estado", width: 10 },
        ],
        rows: rows.map((o) => ({
          nombre: o.name,
          tipo: OBLIGATION_TYPE_LABEL[o.type],
          entidad: o.creditor,
          referencia: texto(o.reference),
          moneda: o.currency,
          capital: money(o.principal),
          tasa: o.annualRate ? `${Number(o.annualRate)} %` : "",
          desembolso: fecha(o.disbursedAt),
          cuotas: o.scheduleCount,
          pagadas: o.paidCount,
          pendientes: o.pendingCount,
          vencidas: o.overdueCount,
          falta: money(o.pendingAmount),
          saldo: money(o.balance),
          proxima: fecha(o.nextDueDate),
          importeProxima: money(o.nextAmount),
          estado: OBLIGATION_STATUS_LABEL[o.status],
        })),
        summary: [
          { label: "Obligaciones", value: rows.length },
          { label: "Cuotas pendientes", value: rows.reduce((s, o) => s + o.pendingCount, 0) },
        ],
      }];
    },
  },

  // ---------- Cronograma de una obligación ----------
  cronograma: {
    title: "Cronograma",
    permission: "obligations.view",
    async build(sp) {
      const id = typeof sp.id === "string" ? sp.id : "";
      const [cuotas, obligaciones] = await Promise.all([listInstallments(id), listObligations({})]);
      const o = obligaciones.find((x) => x.id === id);
      return [{
        title: o ? `Cronograma ${o.name}`.slice(0, 60) : "Cronograma",
        columns: [
          { key: "numero", header: "N.º", width: 6, align: "right" },
          { key: "vence", header: "Vence", width: 12 },
          { key: "capital", header: "Capital", width: 13, align: "right" },
          { key: "interes", header: "Interés", width: 12, align: "right" },
          { key: "seguro", header: "Seguro", width: 11, align: "right" },
          { key: "cuota", header: "Cuota", width: 13, align: "right" },
          { key: "saldo", header: "Saldo después", width: 14, align: "right" },
          { key: "estado", header: "Estado", width: 11 },
          { key: "pago", header: "Fecha de pago", width: 13 },
          { key: "pagado", header: "Importe pagado", width: 14, align: "right" },
          { key: "referencia", header: "Referencia", width: 22 },
          { key: "responsable", header: "Registrado por", width: 20 },
        ],
        rows: cuotas.map((c) => ({
          numero: c.number,
          vence: fecha(c.dueDate),
          capital: money(c.principal),
          interes: money(c.interest),
          seguro: money(c.insurance),
          cuota: c.total === null ? "falta el recibo" : money(c.total),
          saldo: money(c.balanceAfter),
          estado: INSTALLMENT_STATUS_LABEL[c.status],
          pago: fecha(c.paidAt),
          pagado: money(c.paidAmount),
          referencia: texto(c.paymentReference),
          responsable: texto(c.paidByName),
        })),
        summary: [
          { label: "Cuotas", value: cuotas.length },
          { label: "Pagadas", value: cuotas.filter((c) => c.status === "PAGADA").length },
        ],
      }];
    },
  },

  // ---------- Calendario de pagos ----------
  calendario: {
    title: "Calendario de pagos",
    permission: "invoices.view",
    async build(sp) {
      // Se exporta el mes que se está mirando en pantalla. Si no viene ninguno —un enlace
      // viejo, o la exportación desde otro sitio—, se cae a la ventana de días de antes.
      const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima" }).format(new Date());
      const pedido = typeof sp.mes === "string" ? sp.mes : "";
      const mes = /^\d{4}-(0[1-9]|1[0-2])$/.test(pedido) ? pedido : null;
      const mover = (d: number) => new Date(Date.parse(`${hoy}T12:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);

      let desde: string, hasta: string;
      if (mes) {
        desde = monthStart(mes);
        hasta = monthEnd(mes);
      } else {
        const dias = Number(typeof sp.dias === "string" ? sp.dias : "") || 15;
        desde = mover(-30);
        hasta = mover(dias);
      }
      const entradas = await listPaymentCalendar(desde, hasta);
      return [{
        title: "Calendario de pagos",
        columns: [
          { key: "vence", header: "Vence", width: 12 },
          { key: "clase", header: "Concepto", width: 12 },
          { key: "detalle", header: "Detalle", width: 34 },
          { key: "quien", header: "A quién", width: 30 },
          { key: "moneda", header: "Moneda", width: 8 },
          { key: "importe", header: "Importe", width: 13, align: "right" },
          { key: "situacion", header: "Situación", width: 12 },
        ],
        rows: entradas.map((e) => ({
          vence: fecha(e.dueDate),
          clase: e.kind === "FACTURA" ? "Factura" : "Cuota",
          detalle: e.title,
          quien: e.subtitle,
          moneda: e.currency,
          importe: e.amount === null ? "sin importe" : money(e.amount),
          situacion: e.overdue ? "Vencido" : "Por pagar",
        })),
        summary: [
          { label: "Pagos", value: entradas.length },
          { label: "Vencidos", value: entradas.filter((e) => e.overdue).length },
        ],
      }];
    },
  },

  // ---------- Resumen de EPP: dos hojas en un mismo archivo ----------
  "resumen-epp": {
    title: "Resumen de EPP entregados",
    permission: "deliveries.view",
    async build(sp) {
      const resumen = await deliverySummary(readFilters(sp));
      return [
        {
          title: "EPP por producto",
          columns: [
            { key: "codigo", header: "Código", width: 12 },
            { key: "producto", header: "EPP", width: 30 },
            { key: "categoria", header: "Categoría", width: 22 },
            { key: "unidad", header: "Unidad", width: 10 },
            { key: "entregado", header: "Entregado", width: 11, align: "right" },
            { key: "entregas", header: "Entregas", width: 10, align: "right" },
            { key: "trabajadores", header: "Trabajadores", width: 12, align: "right" },
            { key: "stock", header: "Stock actual", width: 12, align: "right" },
            { key: "minimo", header: "Stock mínimo", width: 12, align: "right" },
            { key: "ultima", header: "Última entrega", width: 13 },
          ],
          rows: resumen.porProducto.map((p) => ({
            codigo: p.productCode, producto: p.productName, categoria: p.categoryName, unidad: p.unit,
            entregado: p.unidades, entregas: p.entregas, trabajadores: p.trabajadores,
            stock: p.stock, minimo: p.minimumStock, ultima: fecha(p.ultima),
          })),
          summary: [
            { label: "Productos", value: resumen.porProducto.length },
            { label: "Unidades entregadas", value: resumen.unidades },
          ],
        },
        {
          title: "EPP por trabajador",
          columns: [
            { key: "trabajador", header: "Trabajador", width: 30 },
            { key: "dni", header: "DNI", width: 11 },
            { key: "cargo", header: "Cargo", width: 22 },
            { key: "area", header: "Área", width: 20 },
            { key: "recibido", header: "Recibido", width: 11, align: "right" },
            { key: "tipos", header: "Tipos de EPP", width: 12, align: "right" },
            { key: "entregas", header: "Entregas", width: 10, align: "right" },
            { key: "ultima", header: "Última entrega", width: 13 },
          ],
          rows: resumen.porTrabajador.map((e) => ({
            trabajador: e.employeeName, dni: e.dni, cargo: texto(e.position), area: texto(e.area),
            recibido: e.unidades, tipos: e.tiposEpp, entregas: e.entregas, ultima: fecha(e.ultima),
          })),
          summary: [
            { label: "Trabajadores", value: resumen.porTrabajador.length },
            { label: "Unidades entregadas", value: resumen.unidades },
          ],
        },
        {
          // Una fila por trabajador y EPP: es la hoja que responde «qué tiene cada uno»
          // sin tener que abrir la ficha de cada trabajador.
          title: "Qué EPP tiene cada trabajador",
          columns: [
            { key: "trabajador", header: "Trabajador", width: 28 },
            { key: "dni", header: "DNI", width: 11 },
            { key: "cargo", header: "Cargo", width: 20 },
            { key: "area", header: "Área", width: 18 },
            { key: "producto", header: "EPP", width: 30 },
            { key: "talla", header: "Talla", width: 8 },
            { key: "unidad", header: "Unidad", width: 10 },
            { key: "cantidad", header: "Entregado", width: 11, align: "right" },
            { key: "ultima", header: "Última entrega", width: 13 },
          ],
          rows: resumen.porTrabajador.flatMap((e) =>
            e.epps.map((p) => ({
              trabajador: e.employeeName, dni: e.dni, cargo: texto(e.position), area: texto(e.area),
              producto: p.productName, talla: texto(p.size), unidad: p.unit,
              cantidad: p.unidades, ultima: fecha(p.ultima),
            })),
          ),
          summary: [
            { label: "Combinaciones trabajador-EPP", value: resumen.porTrabajador.reduce((s, e) => s + e.epps.length, 0) },
            { label: "Unidades entregadas", value: resumen.unidades },
          ],
        },
      ];
    },
  },

  // ---------- Trabajadores ----------
  trabajadores: {
    title: "Trabajadores",
    permission: "employees.view",
    async build(sp) {
      const { rows } = await listEmployees({
        q: typeof sp.q === "string" ? sp.q : undefined,
        area: typeof sp.area === "string" ? sp.area : undefined,
        state: typeof sp.estado === "string" ? sp.estado : undefined,
        limit: 5000, offset: 0,
      });
      return [{
        title: "Trabajadores",
        columns: [
          { key: "nombre", header: "Trabajador", width: 30 },
          { key: "dni", header: "DNI", width: 11 },
          { key: "cargo", header: "Cargo", width: 24 },
          { key: "area", header: "Área", width: 20 },
          { key: "ingreso", header: "Fecha de ingreso", width: 14 },
          { key: "cese", header: "Fecha de cese", width: 13 },
          { key: "motivoCese", header: "Motivo del cese", width: 24 },
          { key: "telefono", header: "Teléfono", width: 14 },
          { key: "entregas", header: "Entregas recibidas", width: 15, align: "right" },
          { key: "estado", header: "Estado", width: 12 },
        ],
        rows: rows.map((e) => ({
          nombre: `${e.lastName}, ${e.firstName}`,
          dni: e.dni,
          cargo: texto(e.position),
          area: texto(e.area),
          ingreso: fecha(e.hireDate),
          cese: fecha(e.terminatedAt),
          motivoCese: texto(e.terminationReason),
          telefono: texto(e.phone),
          entregas: e.delivered,
          estado: e.terminatedAt ? "Cesado" : e.active ? "Activo" : "Inactivo",
        })),
        summary: [
          { label: "Trabajadores", value: rows.length },
          { label: "Activos", value: rows.filter((e) => e.active).length },
        ],
      }];
    },
  },

  // ---------- Usuarios ----------
  usuarios: {
    title: "Usuarios del sistema",
    permission: "users.manage",
    async build() {
      const rows = await listUsers();
      return [{
        title: "Usuarios del sistema",
        columns: [
          { key: "nombre", header: "Nombre", width: 28 },
          { key: "usuario", header: "Usuario", width: 18 },
          { key: "correo", header: "Correo", width: 30 },
          { key: "rol", header: "Rol", width: 18 },
          { key: "estado", header: "Estado", width: 10 },
          { key: "alta", header: "Dado de alta", width: 18 },
        ],
        // Las contraseñas no salen en ningún lado, tampoco aquí.
        rows: rows.map((u) => ({
          nombre: u.name, usuario: u.username, correo: u.email,
          rol: ROLE_EXPORT_LABEL[u.role] ?? u.role,
          estado: u.active ? "Activo" : "Inactivo",
          alta: formatDateTime(u.createdAt),
        })),
        summary: [
          { label: "Usuarios", value: rows.length },
          { label: "Activos", value: rows.filter((u) => u.active).length },
        ],
      }];
    },
  },

  // ---------- Auditoría ----------
  auditoria: {
    title: "Auditoría",
    permission: "audit.view",
    async build(sp) {
      const { rows } = await listAudit({
        q: typeof sp.q === "string" ? sp.q : undefined,
        module: typeof sp.modulo === "string" ? sp.modulo : undefined,
        userId: typeof sp.user === "string" ? sp.user : undefined,
        from: typeof sp.from === "string" ? sp.from : undefined,
        to: typeof sp.to === "string" ? sp.to : undefined,
        limit: 5000, offset: 0,
      });
      return [{
        title: "Auditoría",
        columns: [
          { key: "fecha", header: "Fecha y hora", width: 18 },
          { key: "usuario", header: "Usuario", width: 24 },
          { key: "modulo", header: "Módulo", width: 16 },
          { key: "accion", header: "Acción", width: 14 },
          { key: "descripcion", header: "Qué ocurrió", width: 70 },
        ],
        rows: rows.map((a) => ({
          fecha: formatDateTime(a.createdAt),
          usuario: texto(a.userName),
          modulo: a.module,
          accion: a.action,
          descripcion: a.description,
        })),
        summary: [{ label: "Registros", value: rows.length }],
      }];
    },
  },

  // ---------- Inventario ----------
  inventario: {
    title: "Inventario de EPP",
    permission: "products.view",
    async build(sp) {
      const f = readFilters(sp);
      const { rows } = await listProducts({ categoryId: f.categoryId, status: f.status, q: f.q, sort: "code" });
      return [{
        title: "Inventario de EPP",
        columns: [
          { key: "codigo", header: "Código", width: 12 },
          { key: "producto", header: "Producto", width: 32 },
          { key: "categoria", header: "Categoría", width: 22 },
          { key: "marca", header: "Marca", width: 16 },
          { key: "talla", header: "Talla", width: 8 },
          { key: "color", header: "Color", width: 12 },
          { key: "unidad", header: "Unidad", width: 11 },
          { key: "ingresado", header: "Ingresado", width: 11, align: "right" },
          { key: "entregado", header: "Entregado", width: 11, align: "right" },
          { key: "otros", header: "Otros movimientos", width: 16, align: "right" },
          { key: "stock", header: "Stock", width: 9, align: "right" },
          { key: "minimo", header: "Stock mínimo", width: 12, align: "right" },
          { key: "estado", header: "Estado", width: 12 },
        ],
        rows: rows.map((p) => ({
          codigo: p.code, producto: p.name, categoria: p.categoryName, marca: texto(p.brand),
          talla: texto(p.size), color: texto(p.color), unidad: p.unit,
          ingresado: p.ingresado, entregado: p.entregado,
          // Mermas, traslados y ajustes: lo que explica que ingresado − entregado no dé
          // exactamente el stock. En la columna, para que la resta cuadre en el Excel.
          otros: p.stock - (p.ingresado - p.entregado),
          stock: p.stock, minimo: p.minimumStock,
          estado: STOCK_STATUS_LABEL[stockStatus(p.stock, p.minimumStock)],
        })),
        summary: [
          { label: "Productos", value: rows.length },
          { label: "Unidades ingresadas", value: rows.reduce((s, p) => s + p.ingresado, 0) },
          { label: "Unidades entregadas", value: rows.reduce((s, p) => s + p.entregado, 0) },
          { label: "Unidades en stock", value: rows.reduce((s, p) => s + p.stock, 0) },
        ],
      }];
    },
  },

  // ---------- Movimientos ----------
  movimientos: {
    title: "Movimientos de inventario",
    permission: "movements.view",
    async build(sp) {
      const { rows } = await listMovements(readFilters(sp));
      return [{
        title: "Movimientos de inventario",
        columns: [
          { key: "fecha", header: "Fecha y hora", width: 18 },
          { key: "tipo", header: "Tipo", width: 11 },
          { key: "codigo", header: "Código", width: 12 },
          { key: "producto", header: "Producto", width: 30 },
          { key: "categoria", header: "Categoría", width: 20 },
          { key: "cantidad", header: "Cantidad", width: 10, align: "right" },
          { key: "antes", header: "Stock antes", width: 11, align: "right" },
          { key: "despues", header: "Stock después", width: 12, align: "right" },
          { key: "motivo", header: "Motivo", width: 24 },
          { key: "trabajador", header: "Trabajador", width: 26 },
          { key: "responsable", header: "Responsable", width: 22 },
          { key: "observaciones", header: "Observaciones", width: 30 },
        ],
        rows: rows.map((m) => ({
          fecha: formatDateTime(m.createdAt),
          tipo: MOVEMENT_LABEL[m.type],
          codigo: m.productCode, producto: m.productName, categoria: texto(m.categoryName),
          cantidad: m.quantity, antes: m.stockBefore, despues: m.stockAfter,
          motivo: texto(m.reason), trabajador: texto(m.employeeName), responsable: m.userName,
          observaciones: texto(m.notes),
        })),
        summary: [{ label: "Movimientos", value: rows.length }],
      }];
    },
  },

  // ---------- Categorías ----------
  categorias: {
    title: "Categorías",
    permission: "categories.manage",
    async build() {
      const rows = await listCategories();
      return [{
        title: "Categorías",
        columns: [
          { key: "nombre", header: "Categoría", width: 28 },
          { key: "descripcion", header: "Descripción", width: 44 },
          { key: "productos", header: "Productos activos", width: 15, align: "right" },
          { key: "estado", header: "Estado", width: 10 },
        ],
        rows: rows.map((c) => ({
          nombre: c.name, descripcion: texto(c.description),
          productos: c.productCount, estado: c.active ? "Activa" : "Inactiva",
        })),
        summary: [{ label: "Categorías", value: rows.length }],
      }];
    },
  },

  // ---------- Buzón de correos ----------
  correos: {
    title: "Correos de facturas",
    permission: "invoices.mailbox",
    async build(sp) {
      const { rows } = await listInvoiceEmails(readEmailFilters(sp), 5000, 0);
      return [{
        title: "Correos de facturas",
        columns: [
          { key: "recibido", header: "Recibido", width: 18 },
          { key: "comprobante", header: "Comprobante", width: 14 },
          { key: "proveedor", header: "Proveedor", width: 32 },
          { key: "importe", header: "Importe", width: 12, align: "right" },
          { key: "de", header: "De", width: 28 },
          { key: "estado", header: "Estado", width: 13 },
          { key: "decidio", header: "Decidió", width: 20 },
          { key: "motivo", header: "Motivo del rechazo", width: 34 },
          { key: "avisado", header: "Aviso al proveedor", width: 22 },
          { key: "factura", header: "Factura registrada", width: 16 },
          { key: "detalle", header: "Qué pasó", width: 46 },
        ],
        rows: rows.map((e) => {
          const c = e.parsed as { series?: string; number?: string; supplierName?: string; total?: string; currency?: string } | null;
          return {
            recibido: formatDateTime(e.receivedAt),
            comprobante: c?.series && c?.number ? invoiceNumber(c.series, c.number) : "",
            proveedor: texto(c?.supplierName ?? e.supplierName),
            importe: c?.total ? `${c.currency === "USD" ? "US$" : "S/"} ${c.total}` : "",
            de: texto(e.fromAddress),
            estado: EMAIL_STATUS_LABEL[e.status],
            decidio: texto(e.decidedByName),
            motivo: e.rejectReason
              ? `${REJECT_REASON_LABEL[e.rejectReason as RejectReasonKey] ?? e.rejectReason}${e.rejectComment ? ` — ${e.rejectComment}` : ""}`
              : "",
            // Un rechazo cuyo aviso no salió es lo que hay que perseguir: el proveedor no
            // sabe que su factura fue devuelta.
            avisado: e.status !== "RECHAZADO" ? ""
              : e.replySentAt ? `Sí, ${formatDateTime(e.replySentAt)}`
              : e.replyError ? `No salió: ${e.replyError}` : "No se envió",
            factura: e.invoiceSeries && e.invoiceNumber ? invoiceNumber(e.invoiceSeries, e.invoiceNumber) : "",
            detalle: texto(e.detail),
          };
        }),
        summary: [
          { label: "Correos", value: rows.length },
          { label: "Por aprobar", value: rows.filter((e) => e.status === "POR_APROBAR").length },
          { label: "Rechazados", value: rows.filter((e) => e.status === "RECHAZADO").length },
          { label: "Por revisar", value: rows.filter((e) => e.status === "REVISAR" || e.status === "ERROR").length },
        ],
      }];
    },
  },

  // ---------- Entregas, una por una ----------
  entregas: {
    title: "Entregas de EPP",
    permission: "deliveries.view",
    async build(sp) {
      const { rows } = await listDeliveries(readFilters(sp));
      return [{
        title: "Entregas de EPP",
        columns: [
          { key: "fecha", header: "Fecha", width: 11 },
          { key: "trabajador", header: "Trabajador", width: 28 },
          { key: "dni", header: "DNI", width: 11 },
          { key: "cargo", header: "Cargo", width: 20 },
          { key: "area", header: "Área", width: 18 },
          { key: "codigo", header: "Código", width: 12 },
          { key: "producto", header: "EPP", width: 28 },
          { key: "categoria", header: "Categoría", width: 20 },
          { key: "talla", header: "Talla", width: 8 },
          { key: "cantidad", header: "Cantidad", width: 10, align: "right" },
          { key: "motivo", header: "Motivo", width: 18 },
          { key: "responsable", header: "Responsable", width: 20 },
          { key: "estado", header: "Estado", width: 11 },
          { key: "observaciones", header: "Observaciones", width: 30 },
        ],
        rows: rows.map((d) => ({
          fecha: fecha(d.deliveryDate),
          trabajador: d.employeeName, dni: d.dni, cargo: texto(d.position), area: texto(d.area),
          codigo: d.productCode, producto: d.productName, categoria: d.categoryName,
          talla: texto(d.size), cantidad: d.quantity, motivo: d.reason,
          responsable: d.userName,
          estado: d.voidedAt ? "Anulada" : "Vigente",
          observaciones: [texto(d.notes), d.voidReason && `Anulada: ${d.voidReason}`].filter(Boolean).join(" · "),
        })),
        summary: [
          { label: "Entregas", value: rows.length },
          { label: "Unidades", value: rows.filter((d) => !d.voidedAt).reduce((s, d) => s + d.quantity, 0) },
        ],
      }];
    },
  },

  // ---------- Devolución de EPP ----------
  // Dos hojas, porque son dos preguntas distintas: qué falta devolver (lo que hay que
  // reclamar) y qué ya se devolvió (el descargo de cada trabajador).
  /**
   * La ficha de cada móvil, con sus papeles.
   *
   * Es lo que se manda cuando un cliente pide "la relación de unidades": en una sola hoja
   * van los datos del camión, su conductor y la fecha de vencimiento de cada documento,
   * con una columna que dice si ese papel está vigente, vencido o sin cargar.
   */
  flota: {
    title: "Detalle de los móviles",
    permission: "documents.view",
    async build(sp) {
      const filas = await listFleet({
        q: typeof sp.q === "string" ? sp.q.trim() || undefined : undefined,
        estado: typeof sp.estado === "string" ? sp.estado || undefined : undefined,
      });

      /** La fecha de un papel y, al lado, en qué situación está. */
      const papel = (p: { expiresAt: string | null; tieneArchivo: boolean } | null, exigible = true) => {
        if (!p) return { fecha: "", estado: exigible ? "Falta cargarlo" : "No le toca todavía" };
        const estado = DOCUMENT_STATUS_LABEL[documentStatus(p.expiresAt)];
        return {
          fecha: p.expiresAt ? formatDate(p.expiresAt) : "",
          estado: p.tieneArchivo ? estado : `${estado}, sin el PDF`,
        };
      };

      return [{
        title: "Detalle de los móviles",
        columns: [
          { key: "placa", header: "Placa", width: 11 },
          { key: "estado", header: "Situación", width: 16 },
          { key: "marca", header: "Marca", width: 14 },
          { key: "modelo", header: "Modelo", width: 16 },
          { key: "anio", header: "Año", width: 7, align: "right" as const },
          { key: "tn", header: "Capacidad (TN)", width: 13, align: "right" as const },
          { key: "m3", header: "Volumen (m³)", width: 12, align: "right" as const },
          { key: "mtc", header: "Código MTC", width: 15 },
          { key: "gps", header: "GPS", width: 7 },
          { key: "conductor", header: "Conductor", width: 26 },
          { key: "dniConductor", header: "DNI del conductor", width: 13 },
          { key: "licencia", header: "Vence la licencia", width: 14 },
          { key: "soat", header: "Vence el SOAT", width: 13 },
          { key: "soatEstado", header: "Situación del SOAT", width: 19 },
          { key: "rt", header: "Vence la revisión técnica", width: 20 },
          { key: "rtEstado", header: "Situación de la revisión", width: 22 },
          { key: "hab", header: "Vence la habilitación MTC", width: 21 },
          { key: "habEstado", header: "Situación del MTC", width: 19 },
          { key: "tarjeta", header: "Vence la tarjeta de propiedad", width: 24 },
          { key: "tarjetaEstado", header: "Situación de la tarjeta", width: 21 },
          { key: "documentos", header: "Documentos cargados", width: 18, align: "right" as const },
          { key: "activo", header: "En la flota", width: 11 },
        ],
        rows: filas.map((v) => {
          const soat = papel(v.soat);
          const rt = papel(v.revisionTecnica, exigeRevisionTecnica(v.year));
          const hab = papel(v.mtc);
          const tarjeta = papel(v.tarjetaPropiedad);
          return {
            placa: v.plate,
            estado: FLEET_STATUS_LABEL[estadoFlota(v)],
            marca: texto(v.brand),
            modelo: texto(v.model),
            anio: v.year ?? "",
            tn: v.capacityTn === null ? "" : Number(v.capacityTn),
            m3: v.capacityM3 === null ? "" : Number(v.capacityM3),
            mtc: texto(v.mtcCode),
            gps: v.hasGps ? "Sí" : "No",
            conductor: texto(v.driverName),
            dniConductor: texto(v.driverDni),
            licencia: v.licencia?.expiresAt ? formatDate(v.licencia.expiresAt) : "",
            soat: soat.fecha, soatEstado: soat.estado,
            rt: rt.fecha, rtEstado: rt.estado,
            hab: hab.fecha, habEstado: hab.estado,
            tarjeta: tarjeta.fecha, tarjetaEstado: tarjeta.estado,
            documentos: v.documentos,
            activo: v.active ? "Sí" : "Dada de baja",
          };
        }),
        summary: [
          { label: "Unidades", value: filas.length },
          { label: "Pueden salir", value: filas.filter((v) => estadoFlota(v) === "AL_DIA").length },
          { label: "Con algo vencido", value: filas.filter((v) => estadoFlota(v) === "VENCIDO").length },
          { label: "Les falta un papel", value: filas.filter((v) => estadoFlota(v) === "FALTA").length },
        ],
      }];
    },
  },

  /** Lo que le toca a cada unidad, para imprimirlo y llevarlo al taller. */
  mantenimiento: {
    title: "Mantenimiento de la flota",
    permission: "maintenance.view",
    async build(sp) {
      const filas = await listMaintenance(readMaintenanceFilters(sp));
      return [{
        title: "Mantenimiento de la flota",
        columns: [
          { key: "placa", header: "Placa", width: 11 },
          { key: "unidad", header: "Marca y modelo", width: 22 },
          { key: "km", header: "Kilometraje", width: 12, align: "right" as const },
          { key: "mantenimiento", header: "Mantenimiento", width: 20 },
          { key: "ultima", header: "Última vez", width: 12 },
          { key: "ultimoKm", header: "Km de la última", width: 14, align: "right" as const },
          { key: "cada", header: "Cada", width: 20 },
          { key: "proxima", header: "Próxima fecha", width: 13 },
          { key: "proximoKm", header: "Próximo km", width: 12, align: "right" as const },
          { key: "estado", header: "Situación", width: 16 },
          { key: "conductor", header: "Conductor", width: 24 },
        ],
        rows: filas.map((r) => ({
          placa: r.plate,
          unidad: [r.brand, r.model].filter(Boolean).join(" "),
          km: r.odometerKm ?? "",
          mantenimiento: MAINTENANCE_KIND_LABEL[r.kind],
          ultima: r.ultimaFecha ? formatDate(r.ultimaFecha) : "",
          ultimoKm: r.ultimoKm ?? "",
          cada: [r.everyKm && `${r.everyKm.toLocaleString("es-PE")} km`, r.everyDays && `${r.everyDays} días`]
            .filter(Boolean).join(" o "),
          proxima: r.proximaFecha ? formatDate(r.proximaFecha) : "",
          proximoKm: r.proximoKm ?? "",
          estado: MAINTENANCE_STATUS_LABEL[r.estado],
          conductor: texto(r.driverName),
        })),
        summary: [
          { label: "Mantenimientos", value: filas.length },
          { label: "Vencidos", value: filas.filter((r) => r.estado === "VENCIDO").length },
          { label: "Tocan pronto", value: filas.filter((r) => r.estado === "POR_VENCER").length },
        ],
      }];
    },
  },

  devoluciones: {
    title: "Devolución de EPP",
    permission: "deliveries.view",
    async build(sp) {
      const f = readFilters(sp);
      const q = typeof sp.q === "string" ? sp.q.trim() || undefined : undefined;
      const verTodos = sp.pendientes === "todos";
      const [pendientes, { rows }] = await Promise.all([
        listPendingReturns({ q, includeActive: verTodos }),
        listReturns(f),
      ]);

      return [
        {
          title: verTodos ? "EPP a cargo de los trabajadores" : "Pendiente de devolución",
          columns: [
            { key: "trabajador", header: "Trabajador", width: 28 },
            { key: "dni", header: "DNI", width: 11 },
            { key: "cargo", header: "Cargo", width: 20 },
            { key: "area", header: "Área", width: 18 },
            { key: "cese", header: "Fecha de cese", width: 13 },
            { key: "dias", header: "Días desde el cese", width: 15, align: "right" },
            { key: "motivo", header: "Motivo del cese", width: 24 },
            { key: "unidades", header: "Unidades pendientes", width: 16, align: "right" },
            { key: "tipos", header: "Tipos de EPP", width: 12, align: "right" },
            { key: "detalle", header: "EPP pendiente", width: 48 },
          ],
          rows: pendientes.map((p) => ({
            trabajador: p.employeeName, dni: p.dni, cargo: texto(p.position), area: texto(p.area),
            cese: fecha(p.terminatedAt), dias: p.terminatedAt ? p.dias : "",
            motivo: texto(p.terminationReason),
            unidades: p.unidades, tipos: p.tipos, detalle: p.detalle,
          })),
          summary: [
            { label: "Trabajadores", value: pendientes.length },
            { label: "Unidades pendientes", value: pendientes.reduce((s, p) => s + p.unidades, 0) },
            { label: "Cesados", value: pendientes.filter((p) => p.terminatedAt).length },
          ],
        },
        {
          title: "Devoluciones registradas",
          columns: [
            { key: "fecha", header: "Fecha", width: 11 },
            { key: "trabajador", header: "Trabajador", width: 28 },
            { key: "dni", header: "DNI", width: 11 },
            { key: "codigo", header: "Código", width: 12 },
            { key: "producto", header: "EPP", width: 28 },
            { key: "categoria", header: "Categoría", width: 20 },
            { key: "talla", header: "Talla", width: 8 },
            { key: "cantidad", header: "Cantidad", width: 10, align: "right" },
            { key: "condicion", header: "Volvió como", width: 14 },
            { key: "stock", header: "Volvió al stock", width: 13 },
            { key: "motivo", header: "Motivo", width: 22 },
            { key: "responsable", header: "Responsable", width: 20 },
            { key: "observaciones", header: "Observaciones", width: 30 },
          ],
          rows: rows.map((d) => ({
            fecha: fecha(d.returnDate), trabajador: d.employeeName, dni: d.dni,
            codigo: d.productCode, producto: d.productName, categoria: d.categoryName,
            talla: texto(d.size), cantidad: d.quantity,
            condicion: RETURN_CONDITION_LABEL[d.condition],
            stock: d.condition === "REUTILIZABLE" ? "Sí" : "No",
            motivo: d.reason, responsable: d.userName, observaciones: texto(d.notes),
          })),
          summary: [
            { label: "Devoluciones", value: rows.length },
            { label: "Unidades devueltas", value: rows.reduce((s, d) => s + d.quantity, 0) },
            { label: "Reingresadas al stock", value: rows.filter((d) => d.condition === "REUTILIZABLE").reduce((s, d) => s + d.quantity, 0) },
            { label: "No devueltas", value: rows.filter((d) => d.condition === "NO_DEVUELTO").reduce((s, d) => s + d.quantity, 0) },
          ],
        },
      ];
    },
  },
};

export type TableKey = keyof typeof TABLE_EXPORTS;

export function isTableKey(v: string | undefined): v is string {
  return !!v && v in TABLE_EXPORTS;
}

/** Una línea que diga qué filtros llevaba la pantalla, para la cabecera del Excel. */
export function describeTableFilters(sp: SearchParamsRecord): string {
  const partes: string[] = [];
  const etiquetas: Record<string, string> = {
    q: "Búsqueda", estado: "Estado", tipo: "Tipo", moneda: "Moneda", proveedor: "Proveedor",
    cliente: "Cliente", condicion: "Condición", detraccion: "Detracción", origen: "Origen",
    from: "Desde", to: "Hasta", area: "Área", modulo: "Módulo", dias: "Días",
    vencidas: "Solo vencidas", porvencer: "Solo por vencer", singuia: "Solo esperando guía",
  };
  for (const [k, etiqueta] of Object.entries(etiquetas)) {
    const v = sp[k];
    if (typeof v === "string" && v) partes.push(`${etiqueta}: ${v}`);
  }
  return partes.length ? `Filtros — ${partes.join(" · ")}` : "Sin filtros: la tabla completa.";
}

/** Para que el detalle de una factura pueda exportarse con sus propios datos. */
export async function invoiceExists(id: string) {
  return !!(await getInvoice(id));
}
