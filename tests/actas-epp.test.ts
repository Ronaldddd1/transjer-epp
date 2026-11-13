/**
 * El cargo de entrega y el acta de devolución de EPP, el precio unitario y la ficha
 * completa del trabajador.
 *
 *   npx tsx tests/actas-epp.test.ts
 */
import {
  actaDevolucionPdf, cargoEntregaPdf, esCompleta, nombreArchivo, totalDe,
  type DatosCargo, type DatosDevolucion,
} from "../src/server/actas-epp-pdf";
import { employeeSchema, productCreateSchema } from "../src/lib/validations";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("OK  ", n);
  else { fails++; console.log("FALLA", n, JSON.stringify(x ?? "")); }
};

const empresa = { nombre: "Transjer Operador Logístico S.A.C.", ruc: "20600000001" };
const trabajador = { nombre: "JUAN PÉREZ", dni: "45678912", cargo: "Conductor", area: "Flota", ingreso: "2026-01-05", cese: "2026-11-10" };
const casco = { codigo: "EPP-001", descripcion: "Casco de seguridad", talla: "Única", cantidad: 1, precio: 35 };
const botas = { codigo: "EPP-007", descripcion: "Botas de seguridad", talla: "42", cantidad: 2, precio: 89.9 };
const lentes = { codigo: "EPP-003", descripcion: "Lentes", talla: null, cantidad: 1, precio: null };

// --- Totales ---
check("el total suma precio × cantidad", Math.abs(totalDe([casco, botas]) - 214.8) < 1e-9, totalDe([casco, botas]));
check("lo que no tiene precio no suma", totalDe([casco, lentes]) === 35);

// --- Completa o parcial ---
const base = { lineas: [{ ...casco, estado: "REUTILIZABLE" as const }], pendiente: [] };
check("todo devuelto y nada pendiente: completa", esCompleta(base));
check("si queda algo a su cargo: parcial", !esCompleta({ ...base, pendiente: [botas] }));
check("si algo no lo devolvió: parcial, aunque no quede nada",
  !esCompleta({ lineas: [{ ...casco, estado: "NO_DEVUELTO" }], pendiente: [] }));
check("descartado (gastado) cuenta como devuelto",
  esCompleta({ lineas: [{ ...casco, estado: "DESCARTADO" }], pendiente: [] }));

// --- El cargo ---
const cargo: DatosCargo = {
  empresa, trabajador, numero: "CE-20261113-ABC123", fecha: "2026-11-13", motivo: "Entrega inicial",
  responsable: "Administrador", lineas: [casco, botas, lentes],
};
const pdfCargo = cargoEntregaPdf(cargo, "13/11/2026 10:00 por Administrador").toString("latin1");
check("el cargo es un PDF", pdfCargo.startsWith("%PDF"));
check("con su título", pdfCargo.includes("CARGO DE ENTREGA DE EQUIPOS DE PROTECCI"));
check("los precios y el total", pdfCargo.includes("S/ 35.00") && pdfCargo.includes("S/ 179.80") && pdfCargo.includes("S/ 214.80"));
check("el compromiso de devolverlo al retirarse", pdfCargo.includes("DEVOLVERLOS A LA EMPRESA CUANDO ME RETIRE"));
check("la firma y la huella", pdfCargo.includes("Recibí conforme".replace("í", "\xed")) && pdfCargo.includes("Huella digital"));
check("lo que no tiene precio sale con guion", pdfCargo.includes("(Lentes)"));
const vigente = cargoEntregaPdf({ ...cargo, vigente: true }, "x").toString("latin1");
check("el cargo vigente lleva su propio título", vigente.includes("A CARGO DEL") && vigente.includes("TRABAJADOR"));

// --- El acta ---
const parcial: DatosDevolucion = {
  empresa, trabajador, numero: "DV-20261113-DEF456", fecha: "2026-11-13", motivo: "Cese del trabajador",
  responsable: "Almacén", notas: null,
  lineas: [{ ...casco, estado: "REUTILIZABLE" }, { ...botas, cantidad: 1, estado: "NO_DEVUELTO" }],
  pendiente: [{ ...botas, cantidad: 1 }],
};
const pdfParcial = actaDevolucionPdf(parcial, "x").toString("latin1");
check("el acta parcial lo dice arriba", pdfParcial.includes("DEVOLUCI\xd3N PARCIAL"));
check("dice lo que no devolvió y cuánto vale", pdfParcial.includes("No devuelvo: 1 Botas de seguridad, por un valor de S/ 89.90"));
check("y la tabla de lo pendiente", pdfParcial.includes("EPP pendiente de devoluci"));
check("el estado de cada EPP", pdfParcial.includes("Buen estado") && pdfParcial.includes("No devuelto"));

const completa = actaDevolucionPdf({ ...parcial, lineas: [{ ...casco, estado: "REUTILIZABLE" }], pendiente: [] }, "x").toString("latin1");
check("el acta completa lo dice", completa.includes("DEVOLUCI\xd3N COMPLETA"));
check("y que no queda nada pendiente", completa.includes("no queda equipo pendiente"));
check("sin tabla de pendientes", !completa.includes("EPP pendiente de devoluci"));

check("nombre de archivo sin tildes", nombreArchivo("Acta devolución", "JUAN PÉREZ", "2026-11-13") === "Acta devolucion - JUAN PEREZ - 2026-11-13.pdf",
  nombreArchivo("Acta devolución", "JUAN PÉREZ", "2026-11-13"));

// --- Precio unitario del EPP ---
const producto = { code: "x-1", name: "Guante", categoryName: "Manos", unit: "Par", minimumStock: "1", initialStock: "0" };
check("el EPP nuevo exige precio", !productCreateSchema.safeParse(producto).success);
check("acepta S/ y comas", productCreateSchema.parse({ ...producto, unitPrice: "S/ 1,250.5" }).unitPrice === "1250.50");
check("rechaza un precio con letras", !productCreateSchema.safeParse({ ...producto, unitPrice: "diez" }).success);

// --- La ficha del trabajador, completa ---
const ficha = {
  dni: "45678912", firstName: "Juan", lastName: "Pérez", position: "Conductor", area: "Flota",
  phone: "987 654 321", hireDate: "2026-01-05", address: "Av. Lima 123",
  emergencyContactName: "Rosa Pérez", emergencyContactPhone: "912345678", emergencyContactRelation: "Madre",
};
check("con todo, pasa", employeeSchema.safeParse(ficha).success);
for (const campo of ["phone", "hireDate", "address", "emergencyContactName", "emergencyContactPhone", "emergencyContactRelation"] as const) {
  const r = employeeSchema.safeParse({ ...ficha, [campo]: "" });
  check(`sin ${campo}, no pasa`, !r.success && r.error.issues.some((i) => i.path[0] === campo), r.success ? "" : r.error.issues[0]?.message);
}
check("las observaciones siguen siendo opcionales", employeeSchema.safeParse({ ...ficha, notes: "" }).success);
check("un teléfono de 5 dígitos no pasa", !employeeSchema.safeParse({ ...ficha, phone: "12345" }).success);

console.log(fails ? `\n${fails} comprobación(es) fallaron.` : "\nTodo en orden.");
process.exit(fails ? 1 : 0);
