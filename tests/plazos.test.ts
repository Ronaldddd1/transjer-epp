/**
 * Prueba de los plazos de pago.
 *
 * Contado: el plazo corre desde que llega el correo.
 * Crédito: corre desde que además el proveedor entrega la guía en físico, y como deben
 *          cumplirse las dos condiciones, manda la fecha más tardía de las dos.
 */
import { addDays, computePayDueDate, dueInfo, receptionDate } from "../src/lib/utils";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("OK  ", n);
  else { fails++; console.log("FALLA", n, JSON.stringify(x ?? "")); }
};

// ---------- Suma de días ----------
check("suma un día", addDays("2026-09-28", 1) === "2026-09-29");
check("cruza fin de mes", addDays("2026-09-30", 1) === "2026-10-01");
check("cruza fin de año", addDays("2026-12-31", 1) === "2027-01-01");
check("cruza año bisiesto", addDays("2028-02-28", 1) === "2028-02-29", addDays("2028-02-28", 1));
check("suma una semana", addDays("2026-09-28", 7) === "2026-10-05");
check("resta días", addDays("2026-10-01", -1) === "2026-09-30");

// ---------- Contado ----------
const contado = (recepcion: string, dias = 1) =>
  computePayDueDate({ paymentTerm: "CONTADO", termDays: dias, receptionYmd: recepcion });

check("contado: un día desde el correo", contado("2026-09-28") === "2026-09-29", contado("2026-09-28"));
check("contado: el lunes vence el martes", contado("2026-09-28") === "2026-09-29");
check("contado: cruza fin de mes", contado("2026-09-30") === "2026-10-01");
check("contado: plazo de cero días vence el mismo día", contado("2026-09-28", 0) === "2026-09-28");
check("contado: plazo de tres días", contado("2026-09-28", 3) === "2026-10-01");
check("contado: la guía no cambia nada",
  computePayDueDate({ paymentTerm: "CONTADO", termDays: 1, receptionYmd: "2026-09-28", guideReceivedAt: "2026-10-15" }) === "2026-09-29");

// ---------- Crédito ----------
const credito = (recepcion: string, guia: string | null, dias = 7) =>
  computePayDueDate({ paymentTerm: "CREDITO", termDays: dias, receptionYmd: recepcion, guideReceivedAt: guia });

check("crédito sin guía: no tiene fecha", credito("2026-09-28", null) === null, credito("2026-09-28", null));
check("crédito sin guía: cadena vacía tampoco", credito("2026-09-28", "") === null);
check("crédito: una semana desde la guía", credito("2026-09-28", "2026-10-05") === "2026-10-12", credito("2026-09-28", "2026-10-05"));

// Si la guía llegó ANTES que el correo, manda el correo: aún faltaba una de las dos condiciones.
check("la guía antes del correo: manda el correo",
  credito("2026-09-28", "2026-09-20") === "2026-10-05", credito("2026-09-28", "2026-09-20"));
// Y al revés.
check("el correo antes de la guía: manda la guía",
  credito("2026-09-20", "2026-09-28") === "2026-10-05", credito("2026-09-20", "2026-09-28"));
check("mismo día: da igual cuál se tome", credito("2026-09-28", "2026-09-28") === "2026-10-05");
check("crédito con plazo distinto", credito("2026-09-28", "2026-09-28", 15) === "2026-10-13");
check("crédito: cruza fin de año", credito("2026-12-28", "2026-12-28") === "2027-01-04", credito("2026-12-28", "2026-12-28"));

// ---------- Cómo se muestra ----------
const hoy = "2026-09-28";
check("sin fecha: espera la guía", dueInfo(null, hoy).state === "ESPERANDO_GUIA");
check("sin fecha: el texto lo dice", dueInfo(null, hoy).label === "Esperando la guía");
check("vence hoy", dueInfo("2026-09-28", hoy).state === "HOY" && dueInfo("2026-09-28", hoy).days === 0);
check("vence mañana", dueInfo("2026-09-29", hoy).label === "Vence mañana");
check("venció ayer", dueInfo("2026-09-27", hoy).state === "VENCIDA" && dueInfo("2026-09-27", hoy).label === "Venció ayer");
check("venció hace cinco días", dueInfo("2026-09-23", hoy).label === "Venció hace 5 días", dueInfo("2026-09-23", hoy));
check("vence en tres días avisa", dueInfo("2026-10-01", hoy).state === "PRONTO");
check("vence en cuatro días ya no urge", dueInfo("2026-10-02", hoy).state === "PROGRAMADA");

// ---------- Fecha de llegada ----------
check("usa receivedAt si existe", receptionDate({ receivedAt: new Date("2026-09-22T15:00:00Z"), createdAt: new Date("2026-09-24T10:00:00Z") }) === "2026-09-22");
check("usa createdAt si no hay receivedAt", receptionDate({ receivedAt: null, createdAt: new Date("2026-09-24T10:00:00Z") }) === "2026-09-24");
// 04:00 UTC del día 25 son las 23:00 del 24 en Lima: el plazo debe contar desde el 24.
check("respeta la hora de Lima", receptionDate({ createdAt: new Date("2026-09-25T04:00:00Z") }) === "2026-09-24", receptionDate({ createdAt: new Date("2026-09-25T04:00:00Z") }));

console.log(fails === 0 ? "\nPLAZOS: todas las verificaciones superadas" : `\n${fails} FALLAS`);
process.exit(fails === 0 ? 0 : 1);
