import type { Role } from "@/db/schema";

/** Catálogo de permisos. Para un nuevo rol, añade una entrada en ROLE_PERMISSIONS. */
export const PERMISSIONS = [
  "products.view", "products.manage",
  "movements.view", "movements.create", "movements.adjust",
  "deliveries.view", "deliveries.create", "deliveries.void",
  "employees.view", "employees.manage",
  "categories.manage",
  "users.manage",
  "reports.view",
  "audit.view",
  "invoices.view", "invoices.manage", "invoices.pay",
  "suppliers.manage",
  "invoices.mailbox",
  // Aceptar o rechazar un comprobante que llegó por correo. Va aparte de invoices.manage
  // porque decide si la empresa reconoce la deuda y, al rechazar, sale un correo firmado
  // por la empresa: no es lo mismo que registrar una factura ya aceptada.
  "invoices.approve",
  "obligations.view", "obligations.manage", "obligations.pay",
  "detractions.view", "detractions.manage",
  "documents.view", "documents.manage",
  // Mantenimiento de la flota: cambios de aceite, lavados y revisiones periódicas.
  // Va aparte de los documentos porque son dos trabajos distintos: uno cuida los papeles
  // y el otro cuida el camión.
  "maintenance.view", "maintenance.manage",
  // La asistencia diaria. Va aparte de employees.manage porque marcar quién vino es una
  // tarea de todos los días, y editar la ficha de un trabajador no lo es.
  "attendance.view", "attendance.manage",
  // El directorio de clientes de provincia. Lo consulta y lo mantiene todo el mundo: es
  // una agenda de trabajo, no un dato reservado, y el que coordina un viaje puede ser
  // cualquiera de los que están ese día.
  "provinceClients.view", "provinceClients.manage",
  // Las salidas diarias de la flota y la liquidación de su documento (FO, guía, orden).
  "trips.view", "trips.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: PERMISSIONS,
  USUARIO: [
    "products.view",
    "movements.view", "movements.create",
    "deliveries.view", "deliveries.create",
    "employees.view",
    "documents.view",
    "provinceClients.view", "provinceClients.manage",
  ],
  // Jefe de almacén: manda en todo el módulo de EPP, sin usuarios ni facturas.
  JEFE_ALMACEN: [
    "products.view", "products.manage",
    "movements.view", "movements.create", "movements.adjust",
    "deliveries.view", "deliveries.create", "deliveries.void",
    "employees.view", "employees.manage",
    "categories.manage",
    "documents.view", "documents.manage",
    "attendance.view", "attendance.manage",
    "reports.view",
    "provinceClients.view", "provinceClients.manage",
  ],
  // Administración y Finanzas: gestiona las facturas de proveedores, no el almacén.
  FINANZAS: [
    "invoices.view", "invoices.manage", "invoices.pay", "invoices.approve",
    "suppliers.manage",
    "obligations.view", "obligations.manage", "obligations.pay",
    "detractions.view", "detractions.manage",
    "documents.view",
    "trips.view", "trips.manage",
    "reports.view",
    "provinceClients.view", "provinceClients.manage",
  ],
  /**
   * Mantenimiento: cuida que las unidades pasen lo que tienen que pasar.
   *
   * Ve los documentos para saber cuándo vence la revisión técnica, pero no los administra:
   * subir y corregir papeles es trabajo de documentación.
   */
  MANTENIMIENTO: [
    "maintenance.view", "maintenance.manage",
    "documents.view",
    "provinceClients.view", "provinceClients.manage",
  ],
  /** Documentación: los papeles de la flota y de los trabajadores, nada más. */
  DOCUMENTACION: [
    "documents.view", "documents.manage",
    "employees.view",
    "provinceClients.view", "provinceClients.manage",
  ],
  /** Operación: mantenimiento, documentación y almacén. No ve facturas ni usuarios. */
  OPERACION: [
    "maintenance.view", "maintenance.manage",
    "documents.view", "documents.manage",
    "products.view", "products.manage",
    "movements.view", "movements.create", "movements.adjust",
    "deliveries.view", "deliveries.create", "deliveries.void",
    "employees.view", "employees.manage",
    "categories.manage",
    "attendance.view", "attendance.manage",
    "reports.view",
    "provinceClients.view", "provinceClients.manage",
  ],
  // Encargada de detracciones: solo deposita y da cuenta del 4 % al Banco de la Nación.
  // Ve las facturas para saber sobre qué está depositando, pero no las registra ni las paga.
  DETRACCIONES: [
    "invoices.view",
    "detractions.view", "detractions.manage",
    "provinceClients.view", "provinceClients.manage",
  ],
};

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrador",
  JEFE_ALMACEN: "Jefe de almacén",
  USUARIO: "Usuario",
  FINANZAS: "Finanzas",
  DETRACCIONES: "Detracciones",
  MANTENIMIENTO: "Mantenimiento",
  DOCUMENTACION: "Documentación",
  OPERACION: "Operación",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  ADMIN: "Acceso total al sistema.",
  JEFE_ALMACEN: "Almacén completo: productos, categorías, trabajadores, asistencia, ajustes y reportes. Sin usuarios ni facturas.",
  USUARIO: "Almacén: consulta el inventario, registra movimientos y entregas.",
  FINANZAS: "Facturas de proveedores, préstamos y servicios: registra, revisa y marca los pagos.",
  DETRACCIONES: "Solo detracciones: consulta las facturas y registra los depósitos del 4 % al Banco de la Nación.",
  MANTENIMIENTO: "Mantenimiento de la flota: registra cambios de aceite, lavados y revisiones, y ve los documentos para saber cuándo vencen.",
  DOCUMENTACION: "Documentos de la flota y de los trabajadores: los sube, los corrige y controla sus vencimientos.",
  OPERACION: "Mantenimiento, documentos, asistencia y almacén completo. Sin facturas ni usuarios.",
};

// ---------- Accesos por módulo ----------

/**
 * Lo que un usuario puede hacer en un módulo: nada, mirar, o mirar y editar.
 *
 * Reemplaza a los roles para todo el que no es administrador: en vez de elegir un rol
 * armado de antemano, al crear el usuario se marca módulo por módulo. El administrador
 * sigue entrando a todo.
 */
export type Nivel = "none" | "view" | "edit";

export type ModuloSistema = {
  key: string;
  label: string;
  seccion: string;
  /** Lo que da "Solo ver". */
  ver: readonly Permission[];
  /** Lo que se suma con "Ver y editar". */
  editar: readonly Permission[];
};

export const MODULOS: readonly ModuloSistema[] = [
  { key: "inventario", label: "Inventario", seccion: "Almacén",
    ver: ["products.view", "movements.view"],
    editar: ["products.manage", "movements.create", "movements.adjust", "categories.manage"] },
  { key: "entregas", label: "Entrega, resumen y devolución de EPP", seccion: "Almacén",
    ver: ["deliveries.view"], editar: ["deliveries.create", "deliveries.void"] },
  { key: "asistencia", label: "Asistencia", seccion: "Recursos Humanos",
    ver: ["attendance.view"], editar: ["attendance.manage"] },
  { key: "trabajadores", label: "Trabajadores", seccion: "Recursos Humanos",
    ver: ["employees.view"], editar: ["employees.manage"] },
  { key: "salidas", label: "Salidas y liquidación", seccion: "Flota",
    ver: ["trips.view"], editar: ["trips.manage"] },
  { key: "documentos", label: "Documentos", seccion: "Flota",
    ver: ["documents.view"], editar: ["documents.manage"] },
  { key: "mantenimiento", label: "Mantenimiento", seccion: "Flota",
    ver: ["maintenance.view"], editar: ["maintenance.manage"] },
  { key: "clientesProvincia", label: "Clientes de provincia", seccion: "Flota",
    ver: ["provinceClients.view"], editar: ["provinceClients.manage"] },
  { key: "facturas", label: "Facturas y calendario de pagos", seccion: "Proveedores",
    ver: ["invoices.view"], editar: ["invoices.manage", "invoices.pay"] },
  { key: "detracciones", label: "Detracciones", seccion: "Proveedores",
    ver: ["detractions.view"], editar: ["detractions.manage"] },
  // Proveedores no tiene una vista de solo lectura: o se administra el directorio o no.
  { key: "proveedores", label: "Proveedores", seccion: "Proveedores",
    ver: [], editar: ["suppliers.manage"] },
  { key: "buzon", label: "Buzón de correo", seccion: "Proveedores",
    ver: ["invoices.mailbox"], editar: ["invoices.approve"] },
  { key: "obligaciones", label: "Préstamos y servicios", seccion: "Finanzas",
    ver: ["obligations.view"], editar: ["obligations.manage", "obligations.pay"] },
  { key: "usuarios", label: "Usuarios", seccion: "Administración",
    ver: [], editar: ["users.manage"] },
  { key: "auditoria", label: "Auditoría", seccion: "Administración",
    ver: ["audit.view"], editar: [] },
];

export type ModuleAccess = Partial<Record<string, Nivel>>;

/** Los niveles que admite un módulo: sin "Solo ver" si no tiene vista, sin "editar" si no edita. */
export function nivelesDe(m: ModuloSistema): Nivel[] {
  return ["none", ...(m.ver.length ? ["view" as const] : []), ...(m.editar.length ? ["edit" as const] : [])];
}

/** Los permisos que dan unos accesos. Editar incluye ver. */
export function permisosDeAccesos(accesos: ModuleAccess): Set<Permission> {
  const permisos = new Set<Permission>();
  for (const m of MODULOS) {
    const nivel = accesos[m.key];
    if (nivel === "view" || nivel === "edit") m.ver.forEach((p) => permisos.add(p));
    if (nivel === "edit") m.editar.forEach((p) => permisos.add(p));
  }
  return permisos;
}

/**
 * Los accesos equivalentes a un rol de los de antes. Sirve para precargar la grilla al
 * editar un usuario creado con rol, y que no pierda nada sin que nadie lo decida.
 */
export function accesosDesdeRol(role: Role): ModuleAccess {
  const tiene = new Set(ROLE_PERMISSIONS[role] ?? []);
  return Object.fromEntries(MODULOS.map((m) => {
    const edita = m.editar.length > 0 && m.editar.some((p) => tiene.has(p));
    const ve = m.ver.some((p) => tiene.has(p));
    return [m.key, edita ? "edit" : ve ? "view" : "none"];
  }));
}

/** Quien pide permiso: un rol suelto (lo de antes) o un usuario con sus accesos. */
export type SujetoPermiso = Role | { role: Role; moduleAccess?: ModuleAccess | null } | undefined | null;

/**
 * ¿Puede hacer esto?
 *
 * El administrador puede todo. Un usuario con accesos por módulo, lo que esos accesos le
 * den. Uno creado antes, con rol y sin accesos, lo que diga su rol, hasta que se lo edite.
 */
export function can(sujeto: SujetoPermiso, permission: Permission): boolean {
  if (!sujeto) return false;
  if (typeof sujeto === "string") return ROLE_PERMISSIONS[sujeto]?.includes(permission) ?? false;
  if (sujeto.role === "ADMIN") return true;
  if (sujeto.moduleAccess) return permisosDeAccesos(sujeto.moduleAccess).has(permission);
  return ROLE_PERMISSIONS[sujeto.role]?.includes(permission) ?? false;
}
