/** Prueba del calendario de pago de los viernes. */
import { nextFriday, fridaysBetween, paymentSchedule, receptionDate } from "../src/lib/utils";

let fails = 0;
const check = (n: string, c: boolean, x?: unknown) => {
  if (c) console.log("OK  ", n);
  else { fails++; console.log("FALLA", n, JSON.stringify(x ?? "")); }
};

// Semana del 21 al 27 de septiembre de 2026: lunes 21 … viernes 25 … domingo 27
check("lunes → viernes de esa semana", nextFriday("2026-09-21") === "2026-09-25", nextFriday("2026-09-21"));
check("miércoles → viernes de esa semana", nextFriday("2026-09-23") === "2026-09-25");
check("el mismo viernes se mantiene", nextFriday("2026-09-25") === "2026-09-25");
check("sábado → viernes siguiente", nextFriday("2026-09-26") === "2026-10-02", nextFriday("2026-09-26"));
check("domingo → viernes siguiente", nextFriday("2026-09-27") === "2026-10-02");
check("cruza fin de mes", nextFriday("2026-09-30") === "2026-10-02");
check("cruza fin de año", nextFriday("2026-12-29") === "2027-01-01", nextFriday("2026-12-29"));

check("viernes consecutivos", fridaysBetween("2026-09-25", "2026-10-02") === 1);
check("tres semanas", fridaysBetween("2026-09-04", "2026-09-25") === 3);
check("mismo viernes", fridaysBetween("2026-09-25", "2026-09-25") === 0);

// Factura que llegó el martes 22, vista el miércoles 23: se paga el viernes 25
let s = paymentSchedule("2026-09-22", "2026-09-23");
check("en fecha: se paga este viernes", s.effective === "2026-09-25" && s.weeksDelayed === 0 && s.isThisFriday, s);

// La misma factura, ya pasado su viernes (lunes 28): se corre al viernes 2
s = paymentSchedule("2026-09-22", "2026-09-28");
check("pasó su viernes: se corre una semana", s.scheduled === "2026-09-25" && s.effective === "2026-10-02" && s.weeksDelayed === 1, s);

// Tres semanas de atraso
s = paymentSchedule("2026-09-01", "2026-09-22");
check("tres semanas de atraso", s.weeksDelayed === 3 && s.effective === "2026-09-25", s);

// Consultada el viernes mismo: sigue siendo ese viernes
s = paymentSchedule("2026-09-22", "2026-09-25");
check("el propio viernes sigue vigente", s.effective === "2026-09-25" && s.weeksDelayed === 0 && s.isThisFriday, s);

// Factura futura: aún no le toca
s = paymentSchedule("2026-10-06", "2026-09-23");
check("factura posterior: su viernes es después", s.effective === "2026-10-09" && !s.isThisFriday, s);

// Fecha de llegada
check("usa receivedAt si existe", receptionDate({ receivedAt: new Date("2026-09-22T15:00:00Z"), createdAt: new Date("2026-09-24T10:00:00Z") }) === "2026-09-22");
check("usa createdAt si no hay receivedAt", receptionDate({ receivedAt: null, createdAt: new Date("2026-09-24T10:00:00Z") }) === "2026-09-24");
// 04:00 UTC del día 25 son las 23:00 del 24 en Lima
check("respeta la hora de Lima", receptionDate({ createdAt: new Date("2026-09-25T04:00:00Z") }) === "2026-09-24", receptionDate({ createdAt: new Date("2026-09-25T04:00:00Z") }));

console.log(fails === 0 ? "\nVIERNES: todas las verificaciones superadas" : `\n${fails} FALLAS`);
process.exit(fails === 0 ? 0 : 1);
