/**
 * Accesos por módulo: qué puede hacer cada usuario según lo marcado al crearlo.
 *
 *   npx tsx tests/accesos.test.ts
 */
import {
  accesosDesdeRol, can, MODULOS, nivelesDe, permisosDeAccesos, PERMISSIONS, ROLE_PERMISSIONS,
} from "../src/lib/permissions";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("OK  ", n);
  else { fails++; console.log("FALLA", n, JSON.stringify(x ?? "")); }
};

// ---------- El administrador ----------
check("el administrador puede todo", PERMISSIONS.every((p) => can({ role: "ADMIN", moduleAccess: null }, p)));
check("aunque tenga accesos guardados, sigue pudiendo todo",
  can({ role: "ADMIN", moduleAccess: { inventario: "view" } }, "users.manage"));

// ---------- Solo ver / ver y editar ----------
const almacenero = { role: "USUARIO" as const, moduleAccess: { inventario: "edit" as const, entregas: "view" as const } };
check("ver y editar inventario permite cargar entradas", can(almacenero, "movements.create"));
check("y crear categorías desde el producto", can(almacenero, "categories.manage"));
check("editar incluye ver", can(almacenero, "products.view"));
check("solo ver entregas permite mirarlas", can(almacenero, "deliveries.view"));
check("pero no registrar una", !can(almacenero, "deliveries.create"));
check("un módulo sin marcar no se ve", !can(almacenero, "invoices.view") && !can(almacenero, "attendance.view"));
check("sin acceso explícito tampoco", !can({ role: "USUARIO", moduleAccess: { asistencia: "none" } }, "attendance.view"));

// ---------- Salidas ----------
const flota = { role: "USUARIO" as const, moduleAccess: { salidas: "edit" as const } };
check("ver y editar salidas permite liquidar", can(flota, "trips.manage") && can(flota, "trips.view"));
check("solo ver salidas no deja liquidar", !can({ role: "USUARIO", moduleAccess: { salidas: "view" } }, "trips.manage"));

// ---------- Los usuarios de antes, con rol ----------
check("sin accesos guardados manda el rol", can({ role: "FINANZAS", moduleAccess: null }, "invoices.pay"));
check("y no da más que el rol", !can({ role: "FINANZAS", moduleAccess: null }, "attendance.view"));
check("un rol suelto sigue funcionando como antes", can("JEFE_ALMACEN", "products.manage") && !can("JEFE_ALMACEN", "invoices.view"));

// ---------- Pasar de rol a accesos no quita nada ----------
for (const role of Object.keys(ROLE_PERMISSIONS) as (keyof typeof ROLE_PERMISSIONS)[]) {
  if (role === "ADMIN") continue;
  const antes = ROLE_PERMISSIONS[role].filter((p) => p !== "reports.view");
  const despues = permisosDeAccesos(accesosDesdeRol(role));
  const perdidos = antes.filter((p) => !despues.has(p));
  check(`el rol ${role} convertido a accesos conserva lo que tenía`, perdidos.length === 0, perdidos);
}

// ---------- El catálogo ----------
const cubiertos = new Set(MODULOS.flatMap((m) => [...m.ver, ...m.editar]));
const sueltos = PERMISSIONS.filter((p) => !cubiertos.has(p) && p !== "reports.view");
check("todo permiso (salvo el de reportes, que ya no tiene pantalla) cae en algún módulo", sueltos.length === 0, sueltos);
check("proveedores no ofrece 'solo ver', porque no tiene vista de lectura",
  !nivelesDe(MODULOS.find((m) => m.key === "proveedores")!).includes("view"));
check("auditoría no ofrece 'editar'", !nivelesDe(MODULOS.find((m) => m.key === "auditoria")!).includes("edit"));
check("las claves de módulo no se repiten", new Set(MODULOS.map((m) => m.key)).size === MODULOS.length);

console.log(fails === 0 ? "\nTodo en orden." : `\n${fails} comprobación(es) fallaron.`);
process.exit(fails === 0 ? 0 : 1);
