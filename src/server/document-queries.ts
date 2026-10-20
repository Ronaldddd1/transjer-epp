import "server-only";
import { and, asc, desc, eq, ilike, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { documents, employees, users, vehicles } from "@/db/schema";
import {
  DOCUMENT_WARNING_DAYS, documentStatus, exigeRevisionTecnica, first, normalizePlate,
  type SearchParamsRecord,
} from "@/lib/utils";

/**
 * Los documentos de trabajadores y vehículos.
 *
 * Lo que diferencia esto de una carpeta compartida es la fecha de vencimiento: el SOAT y
 * la revisión técnica caducan cada año, y una unidad circulando con el SOAT vencido es una
 * multa y un seguro que no responde. Por eso casi todas las consultas de aquí ordenan por
 * lo que vence antes.
 */

const hoy = sql`(now() at time zone 'America/Lima')::date`;

const subidoPor = { id: users.id, name: users.name };

/** Las columnas que se muestran en el listado. El archivo en sí nunca viaja hasta aquí. */
const columnas = {
  id: documents.id,
  kind: documents.kind,
  title: documents.title,
  issuedAt: documents.issuedAt,
  expiresAt: documents.expiresAt,
  notes: documents.notes,
  filename: documents.filename,
  contentType: documents.contentType,
  sizeBytes: documents.sizeBytes,
  createdAt: documents.createdAt,
  employeeId: documents.employeeId,
  vehicleId: documents.vehicleId,
  uploadedByName: users.name,
};

export type DocumentFilters = {
  q?: string;
  kind?: string;
  /** "VENCIDO" | "POR_VENCER" | "VIGENTE" | "SIN_FECHA" */
  estado?: string;
  /** "TRABAJADOR" | "VEHICULO" */
  de?: string;
};

export function readDocumentFilters(sp: SearchParamsRecord): DocumentFilters {
  return {
    q: first(sp.q)?.trim() || undefined,
    kind: first(sp.tipo) || undefined,
    estado: first(sp.estado) || undefined,
    de: first(sp.de) || undefined,
  };
}

/** El filtro de estado, traducido a SQL sobre la fecha de vencimiento. */
function porEstado(estado: string | undefined): SQL | undefined {
  if (estado === "VENCIDO") return sql`${documents.expiresAt} is not null and ${documents.expiresAt} < ${hoy}`;
  if (estado === "POR_VENCER") {
    return sql`${documents.expiresAt} is not null and ${documents.expiresAt} >= ${hoy}
      and ${documents.expiresAt} <= ${hoy} + ${DOCUMENT_WARNING_DAYS}::int`;
  }
  if (estado === "VIGENTE") return sql`${documents.expiresAt} is not null and ${documents.expiresAt} > ${hoy} + ${DOCUMENT_WARNING_DAYS}::int`;
  if (estado === "SIN_FECHA") return sql`${documents.expiresAt} is null`;
  return undefined;
}

/**
 * El listado general, de todos los documentos.
 *
 * Ordena por lo que vence antes y deja al final lo que no caduca: lo que hay que mirar
 * primero es lo que está por vencerse, no lo que se subió último.
 */
export async function listDocuments(f: DocumentFilters = {}, limit = 100) {
  const condiciones: (SQL | undefined)[] = [porEstado(f.estado)];
  if (f.kind) condiciones.push(eq(documents.kind, f.kind));
  if (f.de === "TRABAJADOR") condiciones.push(isNotNull(documents.employeeId));
  if (f.de === "VEHICULO") condiciones.push(isNotNull(documents.vehicleId));
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    condiciones.push(or(
      ilike(documents.title, like),
      ilike(documents.filename, like),
      ilike(vehicles.plate, like),
      ilike(employees.firstName, like),
      ilike(employees.lastName, like),
      ilike(employees.dni, like),
    ));
  }

  return db.select({
    ...columnas,
    plate: vehicles.plate,
    employeeName: sql<string | null>`nullif(concat_ws(' ', ${employees.firstName}, ${employees.lastName}), '')`,
    employeeDni: employees.dni,
  })
    .from(documents)
    .leftJoin(vehicles, eq(documents.vehicleId, vehicles.id))
    .leftJoin(employees, eq(documents.employeeId, employees.id))
    .leftJoin(users, eq(documents.uploadedBy, users.id))
    .where(and(...condiciones.filter(Boolean) as SQL[]))
    // Lo que no caduca va al final; el resto, lo que vence antes primero.
    .orderBy(sql`${documents.expiresAt} asc nulls last`, desc(documents.createdAt))
    .limit(limit);
}

export type DocumentRowView = Awaited<ReturnType<typeof listDocuments>>[number];

/**
 * Lo mínimo que necesita la tabla para pintar una fila.
 *
 * En el listado general hace falta saber de quién es cada documento; dentro de la ficha de
 * un vehículo o un trabajador eso ya se sabe y no se vuelve a consultar.
 */
export type DocumentRowBase = Awaited<ReturnType<typeof listDocumentsFor>>[number]
  & Partial<Pick<DocumentRowView, "plate" | "employeeName" | "employeeDni">>;

/** Cuántos hay en cada situación, para las pestañas y el aviso de arriba. */
export async function documentCounts() {
  const [fila] = await db.select({
    vencidos: sql<number>`count(*) filter (where ${documents.expiresAt} is not null and ${documents.expiresAt} < ${hoy})::int`,
    porVencer: sql<number>`count(*) filter (where ${documents.expiresAt} is not null and ${documents.expiresAt} >= ${hoy}
      and ${documents.expiresAt} <= ${hoy} + ${DOCUMENT_WARNING_DAYS}::int)::int`,
    vigentes: sql<number>`count(*) filter (where ${documents.expiresAt} is not null and ${documents.expiresAt} > ${hoy} + ${DOCUMENT_WARNING_DAYS}::int)::int`,
    sinFecha: sql<number>`count(*) filter (where ${documents.expiresAt} is null)::int`,
    total: sql<number>`count(*)::int`,
  }).from(documents);
  return fila ?? { vencidos: 0, porVencer: 0, vigentes: 0, sinFecha: 0, total: 0 };
}

/** Los documentos de un trabajador o de un vehículo, para su ficha. */
export async function listDocumentsFor(owner: { employeeId?: string; vehicleId?: string }) {
  const condicion = owner.vehicleId
    ? eq(documents.vehicleId, owner.vehicleId)
    : eq(documents.employeeId, owner.employeeId!);

  return db.select({ ...columnas })
    .from(documents)
    .leftJoin(users, eq(documents.uploadedBy, users.id))
    .where(condicion)
    .orderBy(sql`${documents.expiresAt} asc nulls last`, desc(documents.createdAt));
}

/** El documento con su archivo, para descargarlo. */
export async function getDocumentFile(id: string) {
  const [fila] = await db.select({
    id: documents.id,
    filename: documents.filename,
    contentType: documents.contentType,
    storageDriver: documents.storageDriver,
    storageKey: documents.storageKey,
    content: documents.content,
  }).from(documents).where(eq(documents.id, id)).limit(1);
  return fila ?? null;
}

export async function getDocument(id: string) {
  const [fila] = await db.select({
    ...columnas,
    storageDriver: documents.storageDriver,
    storageKey: documents.storageKey,
    plate: vehicles.plate,
    employeeName: sql<string | null>`nullif(concat_ws(' ', ${employees.firstName}, ${employees.lastName}), '')`,
  })
    .from(documents)
    .leftJoin(vehicles, eq(documents.vehicleId, vehicles.id))
    .leftJoin(employees, eq(documents.employeeId, employees.id))
    .leftJoin(users, eq(documents.uploadedBy, users.id))
    .where(eq(documents.id, id)).limit(1);
  return fila ?? null;
}

// ---------- Vehículos ----------

/**
 * La flota, con el estado de sus papeles.
 *
 * Cada unidad trae cuántos documentos tiene y cuál es el primero que se vence: eso es lo
 * que se mira al abrir la pantalla, no la lista de placas.
 */
export async function listVehicles(q?: string) {
  const laUnidad = sql.raw('"vehicles"."id"');
  const condiciones: SQL[] = [];
  if (q) {
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    condiciones.push(or(ilike(vehicles.plate, like), ilike(vehicles.description, like))!);
  }

  return db.select({
    id: vehicles.id,
    plate: vehicles.plate,
    description: vehicles.description,
    notes: vehicles.notes,
    active: vehicles.active,
    documentos: sql<number>`(select count(*)::int from ${documents} d where d.vehicle_id = ${laUnidad})`,
    proximoVencimiento: sql<string | null>`(select min(d.expires_at)::text from ${documents} d
      where d.vehicle_id = ${laUnidad} and d.expires_at is not null and d.expires_at >= ${hoy})`,
    vencidos: sql<number>`(select count(*)::int from ${documents} d
      where d.vehicle_id = ${laUnidad} and d.expires_at is not null and d.expires_at < ${hoy})`,
  })
    .from(vehicles)
    .where(condiciones.length ? and(...condiciones) : undefined)
    .orderBy(asc(vehicles.plate));
}

export type VehicleRow = Awaited<ReturnType<typeof listVehicles>>[number];

/**
 * Los cuatro papeles que no pueden faltar en una unidad que circula.
 *
 * El orden es el de la tabla y el de la urgencia: sin SOAT la unidad no sale, sin revisión
 * técnica tampoco, la habilitación MTC es la que pide el cliente y la tarjeta de propiedad
 * es la que pide la policía.
 */
export const DOCUMENTOS_CLAVE = ["SOAT", "REVISION_TECNICA", "MTC", "TARJETA_PROPIEDAD"] as const;
export type DocumentoClave = (typeof DOCUMENTOS_CLAVE)[number];

/** Lo que la tabla muestra de cada papel: la fecha, si hay archivo, y a dónde llevar el botón. */
export type PapelResumen = {
  id: string;
  expiresAt: string | null;
  tieneArchivo: boolean;
} | null;

/**
 * De un tipo de documento, el que vale: el que vence más tarde.
 *
 * Una unidad acumula SOAT de varios años y el que importa es el vigente. Mirar el último
 * subido daría el equivocado en cuanto alguien escanea un papel viejo que faltaba.
 */
function papel(kind: DocumentoClave, laUnidad: SQL) {
  return sql<PapelResumen>`(
    select json_build_object(
      'id', d.id,
      'expiresAt', d.expires_at::text,
      'tieneArchivo', d.filename is not null
    )
    from ${documents} d
    where d.vehicle_id = ${laUnidad} and d.kind = ${kind}
    order by d.expires_at desc nulls last, d.created_at desc
    limit 1
  )`;
}

/**
 * La flota con sus papeles puestos en columnas, una fila por placa.
 *
 * Es la vista que se usa de verdad: lo que se pregunta no es "qué documentos hay" sino "a
 * esta unidad le falta algo para salir hoy". Con los documentos en una lista había que
 * abrir unidad por unidad para responder eso.
 */
export async function listFleet(f: { q?: string; estado?: string; soloActivos?: boolean; id?: string } = {}) {
  const laUnidad = sql.raw('"vehicles"."id"');
  const condiciones: SQL[] = [];
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    condiciones.push(or(
      ilike(vehicles.plate, like),
      ilike(vehicles.description, like),
      ilike(vehicles.brand, like),
      ilike(vehicles.model, like),
      ilike(employees.firstName, like),
      ilike(employees.lastName, like),
    )!);
  }
  if (f.soloActivos) condiciones.push(eq(vehicles.active, true));
  if (f.id) condiciones.push(eq(vehicles.id, f.id));

  const filas = await db.select({
    id: vehicles.id,
    plate: vehicles.plate,
    description: vehicles.description,
    brand: vehicles.brand,
    model: vehicles.model,
    year: vehicles.year,
    capacityTn: vehicles.capacityTn,
    capacityM3: vehicles.capacityM3,
    mtcCode: vehicles.mtcCode,
    hasGps: vehicles.hasGps,
    active: vehicles.active,
    driverId: vehicles.driverId,
    driverName: sql<string | null>`nullif(concat_ws(' ', ${employees.firstName}, ${employees.lastName}), '')`,
    driverDni: employees.dni,
    soat: papel("SOAT", laUnidad),
    revisionTecnica: papel("REVISION_TECNICA", laUnidad),
    mtc: papel("MTC", laUnidad),
    tarjetaPropiedad: papel("TARJETA_PROPIEDAD", laUnidad),
    documentos: sql<number>`(select count(*)::int from ${documents} d where d.vehicle_id = ${laUnidad})`,
    vencidos: sql<number>`(select count(*)::int from ${documents} d
      where d.vehicle_id = ${laUnidad} and d.expires_at is not null and d.expires_at < ${hoy})`,
    /** Los papeles del conductor también cuentan: sin licencia vigente no maneja. */
    conductorVencidos: sql<number>`(select count(*)::int from ${documents} d
      where ${vehicles.driverId} is not null and d.employee_id = ${vehicles.driverId}
        and d.kind in ('DNI', 'LICENCIA')
        and d.expires_at is not null and d.expires_at < ${hoy})`,
    licencia: sql<PapelResumen>`(
      select json_build_object('id', d.id, 'expiresAt', d.expires_at::text, 'tieneArchivo', d.filename is not null)
      from ${documents} d
      where ${vehicles.driverId} is not null and d.employee_id = ${vehicles.driverId} and d.kind = 'LICENCIA'
      order by d.expires_at desc nulls last, d.created_at desc limit 1
    )`,
    dniConductor: sql<PapelResumen>`(
      select json_build_object('id', d.id, 'expiresAt', d.expires_at::text, 'tieneArchivo', d.filename is not null)
      from ${documents} d
      where ${vehicles.driverId} is not null and d.employee_id = ${vehicles.driverId} and d.kind = 'DNI'
      order by d.expires_at desc nulls last, d.created_at desc limit 1
    )`,
  })
    .from(vehicles)
    .leftJoin(employees, eq(vehicles.driverId, employees.id))
    .where(condiciones.length ? and(...condiciones) : undefined)
    // Las de baja al final; el resto por placa, que es como se las nombra.
    .orderBy(desc(vehicles.active), asc(vehicles.plate));

  if (!f.estado) return filas;
  return filas.filter((v) => estadoFlota(v) === f.estado);
}

export type FleetRow = Awaited<ReturnType<typeof listFleet>>[number];

/**
 * En qué situación está una unidad, mirando sus cuatro papeles clave y los del conductor.
 *
 * FALTA pesa igual que VENCIDO a propósito: un SOAT que nunca se cargó y un SOAT caducado
 * dejan a la unidad en el mismo sitio si la paran en la carretera.
 */
export function estadoFlota(v: {
  soat: PapelResumen; revisionTecnica: PapelResumen; mtc: PapelResumen; tarjetaPropiedad: PapelResumen;
  licencia?: PapelResumen; driverId?: string | null; year?: number | null;
  vencidos: number; conductorVencidos: number; active: boolean;
}): "BAJA" | "VENCIDO" | "FALTA" | "POR_VENCER" | "AL_DIA" {
  if (!v.active) return "BAJA";

  /**
   * A una unidad de menos de tres años no se le reclama la revisión técnica: todavía no
   * le toca. Si la tiene cargada igual, sus fechas cuentan como las de cualquier otro
   * papel; lo que no cuenta es su ausencia.
   */
  const claves = [
    v.soat,
    ...(exigeRevisionTecnica(v.year) || v.revisionTecnica ? [v.revisionTecnica] : []),
    v.mtc,
    v.tarjetaPropiedad,
  ];
  if (v.vencidos > 0 || v.conductorVencidos > 0) return "VENCIDO";
  if (claves.some((p) => p === null)) return "FALTA";
  if (claves.some((p) => documentStatus(p?.expiresAt ?? null) === "POR_VENCER")) return "POR_VENCER";
  if (v.licencia && documentStatus(v.licencia.expiresAt) === "POR_VENCER") return "POR_VENCER";
  return "AL_DIA";
}

/** Cuántas unidades hay en cada situación, para las pestañas de arriba. */
export async function fleetCounts() {
  const filas = await listFleet();
  const cuenta = { total: filas.length, vencido: 0, falta: 0, porVencer: 0, alDia: 0, baja: 0 };
  for (const v of filas) {
    const e = estadoFlota(v);
    if (e === "VENCIDO") cuenta.vencido++;
    else if (e === "FALTA") cuenta.falta++;
    else if (e === "POR_VENCER") cuenta.porVencer++;
    else if (e === "AL_DIA") cuenta.alDia++;
    else cuenta.baja++;
  }
  return cuenta;
}

export async function getVehicle(id: string) {
  const [fila] = await db.select().from(vehicles).where(eq(vehicles.id, id)).limit(1);
  return fila ?? null;
}

export async function getVehicleByPlate(plate: string) {
  const [fila] = await db.select().from(vehicles)
    .where(eq(vehicles.plate, normalizePlate(plate))).limit(1);
  return fila ?? null;
}

/** Para los desplegables del formulario de documentos. */
export async function vehicleOptions() {
  return db.select({ id: vehicles.id, plate: vehicles.plate, description: vehicles.description })
    .from(vehicles).where(eq(vehicles.active, true)).orderBy(asc(vehicles.plate));
}

export async function employeeOptions() {
  return db.select({
    id: employees.id,
    name: sql<string>`concat_ws(' ', ${employees.firstName}, ${employees.lastName})`,
    dni: employees.dni,
  }).from(employees).where(eq(employees.active, true))
    .orderBy(asc(employees.lastName), asc(employees.firstName));
}

export { subidoPor };
