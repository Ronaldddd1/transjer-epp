/**
 * Qué puede hacer cada rol.
 *
 * Un permiso de más no se nota hasta que alguien borra algo que no le tocaba, así que lo
 * que se comprueba aquí no es solo lo que cada rol PUEDE, sino sobre todo lo que NO puede.
 * Las facturas son la frontera que más importa: quien cuida camiones no decide pagos.
 *
 *   npx tsx tests/roles.test.ts
 */
import { can, PERMISSIONS, ROLE_DESCRIPTIONS, ROLE_LABELS, ROLE_PERMISSIONS } from "../src/lib/permissions";
import type { Role } from "../src/db/schema";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("OK  ", n);
  else { fails++; console.log("FALLA", n, JSON.stringify(x ?? "")); }
};

const ROLES = Object.keys(ROLE_PERMISSIONS) as Role[];

function main() {
  // ---------- Que ningún rol quede a medio definir ----------
  for (const rol of ROLES) {
    check(`${rol} tiene nombre y descripción`, !!ROLE_LABELS[rol] && !!ROLE_DESCRIPTIONS[rol]);
    check(`${rol} no tiene permisos inventados`,
      ROLE_PERMISSIONS[rol].every((p) => PERMISSIONS.includes(p)),
      ROLE_PERMISSIONS[rol].filter((p) => !PERMISSIONS.includes(p)));
  }
  check("el administrador los tiene todos", ROLE_PERMISSIONS.ADMIN.length === PERMISSIONS.length);

  // ---------- Mantenimiento ----------
  check("mantenimiento registra los servicios", can("MANTENIMIENTO", "maintenance.manage"));
  check("y ve los documentos, para saber cuándo vence la revisión técnica",
    can("MANTENIMIENTO", "documents.view"));
  check("pero NO sube ni corrige documentos: eso es de documentación",
    !can("MANTENIMIENTO", "documents.manage"));
  check("no ve facturas", !can("MANTENIMIENTO", "invoices.view"));
  check("no toca el almacén", !can("MANTENIMIENTO", "products.view"));
  check("y no administra usuarios", !can("MANTENIMIENTO", "users.manage"));

  // ---------- Documentación ----------
  check("documentación sube y corrige documentos", can("DOCUMENTACION", "documents.manage"));
  check("y ve a los trabajadores, que son dueños de la mitad de los papeles",
    can("DOCUMENTACION", "employees.view"));
  check("pero NO registra mantenimientos", !can("DOCUMENTACION", "maintenance.manage"));
  check("ni los ve", !can("DOCUMENTACION", "maintenance.view"));
  check("no ve facturas", !can("DOCUMENTACION", "invoices.view"));
  check("y no toca el almacén", !can("DOCUMENTACION", "products.manage"));

  // ---------- Operación ----------
  check("operación hace mantenimiento", can("OPERACION", "maintenance.manage"));
  check("y documentación", can("OPERACION", "documents.manage"));
  check("y maneja el almacén entero",
    can("OPERACION", "products.manage") && can("OPERACION", "movements.adjust")
    && can("OPERACION", "deliveries.create"));
  check("ve los reportes, que son de almacén", can("OPERACION", "reports.view"));
  check("pero NO ve facturas", !can("OPERACION", "invoices.view"));
  check("ni detracciones", !can("OPERACION", "detractions.view"));
  check("ni préstamos", !can("OPERACION", "obligations.view"));
  check("ni administra usuarios", !can("OPERACION", "users.manage"));
  check("ni ve la auditoría", !can("OPERACION", "audit.view"));

  /**
   * Operación tiene que incluir a los otros dos, que es lo que se pidió: el jefe de
   * operaciones no puede quedarse sin poder hacer algo que sí hace su gente.
   */
  for (const p of [...ROLE_PERMISSIONS.MANTENIMIENTO, ...ROLE_PERMISSIONS.DOCUMENTACION]) {
    check(`operación puede todo lo de los otros dos: ${p}`, can("OPERACION", p));
  }

  // ---------- Los roles de antes no cambiaron ----------
  check("finanzas sigue sin tocar el almacén", !can("FINANZAS", "products.manage"));
  check("y sigue aprobando comprobantes", can("FINANZAS", "invoices.approve"));
  check("detracciones sigue viendo solo lo suyo",
    !can("DETRACCIONES", "invoices.manage") && can("DETRACCIONES", "detractions.manage"));
  check("el jefe de almacén no hereda mantenimiento sin querer",
    !can("JEFE_ALMACEN", "maintenance.manage"));
  check("y el usuario corriente tampoco", !can("USUARIO", "maintenance.view"));

  // ---------- Nadie salvo el administrador administra usuarios ----------
  const administran = ROLES.filter((r) => can(r, "users.manage"));
  check("solo el administrador crea usuarios", administran.length === 1 && administran[0] === "ADMIN", administran);

  console.log(fails === 0 ? `\nTodo bien (${fails} fallos)` : `\n${fails} FALLO(S)`);
  process.exit(fails === 0 ? 0 : 1);
}

main();
