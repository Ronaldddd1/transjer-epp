import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";

/**
 * Los dos papeles que firma el trabajador por su EPP.
 *
 *  - El CARGO DE ENTREGA: lo que recibe, el precio de cada cosa y el compromiso de
 *    devolverlo cuando se retire de la empresa.
 *  - El ACTA DE DEVOLUCIÓN: lo que entrega de vuelta, en qué estado, y si con eso queda
 *    todo devuelto (completa) o todavía le falta algo (parcial).
 *
 * Aquí solo se dibuja: los datos llegan armados (actas-epp.ts), así se puede probar sin
 * base de datos.
 */

export type Trabajador = {
  nombre: string;
  dni: string;
  cargo: string;
  area: string;
  ingreso: string | null;
  cese: string | null;
};

export type LineaEpp = {
  codigo: string;
  descripcion: string;
  talla: string | null;
  cantidad: number;
  /** Precio unitario en soles; null si el EPP todavía no tenía precio. */
  precio: number | null;
};

export type LineaDevuelta = LineaEpp & { estado: "REUTILIZABLE" | "DESCARTADO" | "NO_DEVUELTO" };

export type Empresa = { nombre: string; ruc: string | null };

export type DatosCargo = {
  empresa: Empresa;
  trabajador: Trabajador;
  numero: string;
  fecha: string;
  motivo: string;
  responsable: string;
  lineas: LineaEpp[];
  notas?: string | null;
  /** "vigente" = todo lo que tiene a su cargo hoy, no una entrega puntual. */
  vigente?: boolean;
};

export type DatosDevolucion = {
  empresa: Empresa;
  trabajador: Trabajador;
  numero: string;
  fecha: string;
  motivo: string;
  responsable: string;
  lineas: LineaDevuelta[];
  /** Lo que le sigue quedando a su cargo después de esta devolución. */
  pendiente: LineaEpp[];
  notas?: string | null;
};

export const ESTADO_ACTA: Record<LineaDevuelta["estado"], string> = {
  REUTILIZABLE: "Buen estado",
  DESCARTADO: "Deteriorado",
  NO_DEVUELTO: "No devuelto",
};

const AMARILLO: [number, number, number] = [255, 194, 14];
const NEGRO: [number, number, number] = [0, 0, 0];
const GRIS: [number, number, number] = [82, 82, 90];
const M = 16;

const soles = (n: number) =>
  `S/ ${new Intl.NumberFormat("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
const fecha = (ymd: string | null) => {
  if (!ymd) return "—";
  const [y, m, d] = ymd.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};
const importe = (l: LineaEpp) => (l.precio == null ? null : l.precio * l.cantidad);
export const totalDe = (lineas: LineaEpp[]) => lineas.reduce((s, l) => s + (importe(l) ?? 0), 0);

/** Completa = no le queda nada a su cargo y todo lo de esta acta volvió de verdad. */
export function esCompleta(d: Pick<DatosDevolucion, "lineas" | "pendiente">) {
  return d.pendiente.length === 0 && d.lineas.every((l) => l.estado !== "NO_DEVUELTO");
}

function encabezado(doc: jsPDF, empresa: Empresa, titulo: string, numero: string) {
  const w = doc.internal.pageSize.getWidth();
  doc.setFillColor(...AMARILLO);
  doc.rect(0, 0, w, 5, "F");
  doc.setTextColor(...NEGRO);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(empresa.nombre, M, 15);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...GRIS);
  if (empresa.ruc) doc.text(`RUC ${empresa.ruc}`, M, 19.5);
  doc.text(`N° ${numero}`, w - M, 15, { align: "right" });

  doc.setTextColor(...NEGRO);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13.5);
  const lineas = doc.splitTextToSize(titulo, w - 2 * M);
  doc.text(lineas, w / 2, 30, { align: "center" });
  return 30 + lineas.length * 6;
}

/** Los datos del trabajador en dos columnas, dentro de un recuadro. */
function ficha(doc: jsPDF, y: number, pares: [string, string][]) {
  const w = doc.internal.pageSize.getWidth();
  const col = (w - 2 * M) / 2;
  const filas = Math.ceil(pares.length / 2);
  const alto = filas * 6.2 + 4;
  doc.setDrawColor(200, 200, 205);
  doc.setLineWidth(0.3);
  doc.roundedRect(M, y, w - 2 * M, alto, 1.5, 1.5);
  doc.setFontSize(9);
  // Las etiquetas de cada columna se miden en negrita (como se dibujan) y los valores
  // arrancan todos a la misma altura: así se leen como una ficha y no se pegan.
  doc.setFont("helvetica", "bold");
  const etiqueta = [0, 1].map((c) => Math.max(...pares.filter((_, i) => i % 2 === c).map(([k]) => doc.getTextWidth(`${k}:`))) + 2.5);
  pares.forEach(([k, v], i) => {
    const x = M + 3 + (i % 2) * col;
    const yy = y + 6 + Math.floor(i / 2) * 6.2;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...GRIS);
    doc.text(`${k}:`, x, yy);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...NEGRO);
    const ancho = etiqueta[i % 2];
    doc.text(doc.splitTextToSize(v || "—", col - ancho - 6)[0], x + ancho, yy);
  });
  return y + alto + 5;
}

function parrafos(doc: jsPDF, y: number, textos: string[], tam = 9.2) {
  const w = doc.internal.pageSize.getWidth();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(tam);
  doc.setTextColor(...NEGRO);
  for (const t of textos) {
    const lineas = doc.splitTextToSize(t, w - 2 * M);
    y = asegurarEspacio(doc, y, lineas.length * 4.4 + 2);
    doc.text(lineas, M, y);
    y += lineas.length * 4.4 + 1.6;
  }
  return y;
}

function asegurarEspacio(doc: jsPDF, y: number, alto: number) {
  const h = doc.internal.pageSize.getHeight();
  if (y + alto > h - 18) {
    doc.addPage();
    return 20;
  }
  return y;
}

function firmas(doc: jsPDF, y: number, izq: { titulo: string; nombre: string; dni?: string }, der: { titulo: string; nombre: string }) {
  const w = doc.internal.pageSize.getWidth();
  y = asegurarEspacio(doc, y, 48);
  y += 26;
  const ancho = 62;
  const huella = 24;
  // Izquierda: firma del trabajador, con su recuadro para la huella.
  doc.setDrawColor(...NEGRO);
  doc.setLineWidth(0.3);
  doc.line(M, y, M + ancho, y);
  doc.rect(M + ancho + 4, y - 26, huella, 28);
  doc.setFontSize(7.5);
  doc.setTextColor(...GRIS);
  doc.text("Huella digital", M + ancho + 4 + huella / 2, y + 5.5, { align: "center" });
  doc.setFontSize(9);
  doc.setTextColor(...NEGRO);
  doc.setFont("helvetica", "bold");
  doc.text(izq.titulo, M, y + 4.5);
  doc.setFont("helvetica", "normal");
  doc.text(izq.nombre, M, y + 9);
  if (izq.dni) doc.text(`DNI ${izq.dni}`, M, y + 13.5);
  // Derecha: quien entrega o recibe por la empresa.
  const x = w - M - ancho;
  doc.line(x, y, x + ancho, y);
  doc.setFont("helvetica", "bold");
  doc.text(der.titulo, x, y + 4.5);
  doc.setFont("helvetica", "normal");
  doc.text(der.nombre, x, y + 9);
  return y + 18;
}

function pie(doc: jsPDF, texto: string) {
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    const w = doc.internal.pageSize.getWidth();
    const h = doc.internal.pageSize.getHeight();
    doc.setFontSize(7.5);
    doc.setTextColor(120, 120, 128);
    doc.text(texto, M, h - 8);
    doc.text(`Página ${i} de ${total}`, w - M, h - 8, { align: "right" });
  }
}

function tablaEpp(doc: jsPDF, y: number, lineas: (LineaEpp & { estado?: string })[], conEstado: boolean, titulo?: string) {
  if (titulo) {
    y = asegurarEspacio(doc, y, 16);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...NEGRO);
    doc.text(titulo, M, y);
    y += 2.5;
  }
  const head = ["N°", "Código", "Descripción", "Talla", "Cant.", ...(conEstado ? ["Estado"] : []), "P. unit.", "Importe"];
  const total = totalDe(lineas);
  const sinPrecio = lineas.some((l) => l.precio == null);
  autoTable(doc, {
    startY: y,
    head: [head],
    body: lineas.map((l, i) => [
      String(i + 1), l.codigo, l.descripcion, l.talla ?? "—", String(l.cantidad),
      ...(conEstado ? [l.estado ?? ""] : []),
      l.precio == null ? "—" : soles(l.precio),
      importe(l) == null ? "—" : soles(importe(l)!),
    ]),
    foot: [[
      { content: "TOTAL", colSpan: head.length - 3, styles: { halign: "right" } },
      String(lineas.reduce((s, l) => s + l.cantidad, 0)),
      { content: sinPrecio && total === 0 ? "—" : soles(total), colSpan: 2, styles: { halign: "right" } },
    ]],
    styles: { fontSize: 8.6, cellPadding: 1.8, overflow: "linebreak", lineColor: [210, 210, 214], lineWidth: 0.2 },
    headStyles: { fillColor: NEGRO, textColor: [255, 255, 255], fontStyle: "bold" },
    footStyles: { fillColor: [247, 247, 248], textColor: NEGRO, fontStyle: "bold" },
    columnStyles: conEstado
      ? { 0: { cellWidth: 9, halign: "center" }, 1: { cellWidth: 20 }, 3: { cellWidth: 13 }, 4: { cellWidth: 12, halign: "right" }, 5: { cellWidth: 23 }, 6: { cellWidth: 21, halign: "right" }, 7: { cellWidth: 23, halign: "right" } }
      : { 0: { cellWidth: 9, halign: "center" }, 1: { cellWidth: 22 }, 3: { cellWidth: 15 }, 4: { cellWidth: 13, halign: "right" }, 5: { cellWidth: 24, halign: "right" }, 6: { cellWidth: 26, halign: "right" } },
    margin: { left: M, right: M },
  });
  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
}

/** El cargo que firma el trabajador al recibir su EPP. */
export function cargoEntregaPdf(d: DatosCargo, generado: string) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = encabezado(
    doc, d.empresa,
    d.vigente ? "CARGO DE EQUIPOS DE PROTECCIÓN PERSONAL (EPP) A CARGO DEL TRABAJADOR" : "CARGO DE ENTREGA DE EQUIPOS DE PROTECCIÓN PERSONAL (EPP)",
    d.numero,
  );
  y = ficha(doc, y, [
    ["Trabajador", d.trabajador.nombre],
    ["DNI", d.trabajador.dni],
    ["Cargo", d.trabajador.cargo],
    ["Área", d.trabajador.area],
    ["Fecha de ingreso", fecha(d.trabajador.ingreso)],
    [d.vigente ? "Al" : "Fecha de entrega", fecha(d.fecha)],
    ["Motivo", d.motivo],
    ["Entregado por", d.responsable],
  ]);

  y = tablaEpp(doc, y, d.lineas, false);

  const total = totalDe(d.lineas);
  y = parrafos(doc, y, [
    `Yo, ${d.trabajador.nombre}, identificado con DNI ${d.trabajador.dni}, declaro haber recibido de ${d.empresa.nombre} `
      + `los equipos de protección personal detallados${total > 0 ? `, por un valor total de ${soles(total)},` : ""} `
      + "en buen estado y para mi uso exclusivo en el trabajo. Me comprometo a:",
    "1. Usarlos durante mi jornada y conforme a las indicaciones de seguridad recibidas.",
    "2. Cuidarlos y conservarlos, e informar de inmediato su pérdida o deterioro para su reposición.",
    "3. DEVOLVERLOS A LA EMPRESA CUANDO ME RETIRE DE ELLA (cese, renuncia, despido o término de contrato), "
      + "o cuando se me pida para su cambio.",
    "Los precios indicados corresponden al valor de cada equipo a la fecha de esta entrega.",
  ]);
  if (d.notas) y = parrafos(doc, y, [`Observaciones: ${d.notas}`], 8.6);

  firmas(
    doc, y,
    { titulo: "Recibí conforme", nombre: d.trabajador.nombre, dni: d.trabajador.dni },
    { titulo: "Entregado por", nombre: d.responsable },
  );
  pie(doc, `Transjer Gestión · Generado el ${generado}`);
  return Buffer.from(doc.output("arraybuffer"));
}

/** El acta que firma el trabajador al devolver su EPP (normalmente al retirarse). */
export function actaDevolucionPdf(d: DatosDevolucion, generado: string) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const w = doc.internal.pageSize.getWidth();
  let y = encabezado(doc, d.empresa, "ACTA DE DEVOLUCIÓN DE EQUIPOS DE PROTECCIÓN PERSONAL (EPP)", d.numero);

  // Lo primero que se lee: si devolvió todo o no.
  const completa = esCompleta(d);
  doc.setFillColor(...(completa ? [220, 252, 231] as [number, number, number] : [255, 243, 205] as [number, number, number]));
  doc.setDrawColor(...(completa ? [21, 128, 61] as [number, number, number] : [180, 120, 0] as [number, number, number]));
  doc.roundedRect(w / 2 - 38, y - 4, 76, 9, 1.5, 1.5, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...(completa ? [21, 101, 52] as [number, number, number] : [122, 90, 0] as [number, number, number]));
  doc.text(completa ? "DEVOLUCIÓN COMPLETA" : "DEVOLUCIÓN PARCIAL", w / 2, y + 2, { align: "center" });
  y += 11;

  y = ficha(doc, y, [
    ["Trabajador", d.trabajador.nombre],
    ["DNI", d.trabajador.dni],
    ["Cargo", d.trabajador.cargo],
    ["Área", d.trabajador.area],
    ["Fecha de ingreso", fecha(d.trabajador.ingreso)],
    ["Fecha de cese", fecha(d.trabajador.cese)],
    ["Fecha de devolución", fecha(d.fecha)],
    ["Motivo", d.motivo],
  ]);

  y = tablaEpp(doc, y, d.lineas.map((l) => ({ ...l, estado: ESTADO_ACTA[l.estado] })), true, "EPP que entrega");

  const noDevuelto = d.lineas.filter((l) => l.estado === "NO_DEVUELTO");
  const devueltas = d.lineas.filter((l) => l.estado !== "NO_DEVUELTO");
  const textos = [
    `Yo, ${d.trabajador.nombre}, identificado con DNI ${d.trabajador.dni}, hago entrega a ${d.empresa.nombre} `
      + `de ${devueltas.reduce((s, l) => s + l.cantidad, 0)} unidad(es) de equipos de protección personal, en el estado que se indica.`,
  ];
  if (completa) {
    textos.push("Con esta devolución entrego la totalidad del EPP que tenía a mi cargo: no queda equipo pendiente de devolución.");
  } else {
    if (noDevuelto.length) {
      const valor = totalDe(noDevuelto);
      textos.push(
        `No devuelvo: ${noDevuelto.map((l) => `${l.cantidad} ${l.descripcion}`).join(", ")}`
        + `${valor > 0 ? `, por un valor de ${soles(valor)}` : ""}.`,
      );
    }
    if (d.pendiente.length) {
      textos.push("La devolución es PARCIAL: queda a mi cargo, pendiente de devolver, el EPP que se detalla a continuación.");
    }
  }
  y = parrafos(doc, y, textos);
  if (d.pendiente.length) y = tablaEpp(doc, y + 1, d.pendiente, false, "EPP pendiente de devolución");
  if (d.notas) y = parrafos(doc, y, [`Observaciones: ${d.notas}`], 8.6);

  firmas(
    doc, y,
    { titulo: "Entregué conforme", nombre: d.trabajador.nombre, dni: d.trabajador.dni },
    { titulo: "Recibido por", nombre: d.responsable },
  );
  pie(doc, `Transjer Gestión · Generado el ${generado}`);
  return Buffer.from(doc.output("arraybuffer"));
}

/** Nombre de archivo sin tildes, para que se descargue igual en cualquier navegador. */
export function nombreArchivo(tipo: string, trabajador: string, ymd: string) {
  const limpio = `${tipo} - ${trabajador} - ${ymd}`
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^\w .-]/g, "").replace(/\s+/g, " ").trim();
  return `${limpio}.pdf`;
}
