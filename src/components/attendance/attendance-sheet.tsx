"use client";

import { Check, CircleSlash, FileText, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { saveAttendance } from "@/actions/attendance";
import { Button } from "@/components/ui/button";
import { TableShell, Td, Th, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { cn, formatDate } from "@/lib/utils";

export type FilaAsistencia = {
  employeeId: string;
  nombre: string;
  dni: string;
  position: string;
  area: string;
  status: "PRESENTE" | "FALTA" | "JUSTIFICADO" | null;
  reason: string | null;
  activity: string | null;
  recordedByName: string | null;
};

type Estado = "PRESENTE" | "FALTA" | "JUSTIFICADO";

const BOTONES: { valor: Estado; etiqueta: string; icono: typeof Check; activo: string }[] = [
  { valor: "PRESENTE", etiqueta: "Vino", icono: Check, activo: "border-emerald-600 bg-emerald-600 text-white" },
  { valor: "FALTA", etiqueta: "Faltó", icono: X, activo: "border-red-600 bg-red-600 text-white" },
  { valor: "JUSTIFICADO", etiqueta: "Justificado", icono: FileText, activo: "border-[#7A5A00] bg-brand text-ink" },
];

/**
 * Pasar lista.
 *
 * Tres botones por trabajador y un solo guardado al final. Se hizo así, y no con un
 * guardado por clic, porque pasar lista es una tarea de corrido: con veinte peticiones de
 * por medio, basta que el internet falle a la mitad para quedarse sin saber por dónde iba.
 *
 * Lo que no se marca NO se guarda. Un día sin registrar es un dato que falta, y mezclarlo
 * con las faltas de verdad arruinaría el único número que esta pantalla tiene que dar bien.
 */
export function AttendanceSheet({ dia, filas, puedeMarcar }: {
  dia: string;
  filas: FilaAsistencia[];
  puedeMarcar: boolean;
}) {
  const [marcas, setMarcas] = useState<Record<string, Estado | null>>(
    () => Object.fromEntries(filas.map((f) => [f.employeeId, f.status])),
  );
  const [motivos, setMotivos] = useState<Record<string, string>>(
    () => Object.fromEntries(filas.map((f) => [f.employeeId, f.reason ?? ""])),
  );
  const [actividades, setActividades] = useState<Record<string, string>>(
    () => Object.fromEntries(filas.map((f) => [f.employeeId, f.activity ?? ""])),
  );
  /** La actividad que se le pone de golpe a toda la cuadrilla que vino. */
  const [actividadComun, setActividadComun] = useState("");
  /** Se marcan en rojo recién al intentar guardar, no mientras se escribe. */
  const [faltantes, setFaltantes] = useState<Set<string>>(new Set());
  const [guardando, start] = useTransition();
  const { notify } = useToast();
  const router = useRouter();

  const cuentas = useMemo(() => {
    const c = { PRESENTE: 0, FALTA: 0, JUSTIFICADO: 0, sinMarcar: 0 };
    for (const f of filas) {
      const m = marcas[f.employeeId];
      if (m) c[m]++;
      else c.sinMarcar++;
    }
    return c;
  }, [filas, marcas]);

  /**
   * Las filas que cambiaron respecto a lo guardado: son las únicas que se mandan.
   *
   * Mandar la lista entera volvería a estampar la fecha y el responsable en marcas que
   * nadie tocó, y obligaría a completar la actividad de los días registrados antes de que
   * ese campo existiera, que es justo lo que impediría corregir un día viejo.
   */
  const pendientes = filas.filter((f) => {
    const m = marcas[f.employeeId] ?? null;
    if (m !== f.status) return true;
    if (m === "JUSTIFICADO") return (motivos[f.employeeId] ?? "") !== (f.reason ?? "");
    if (m === "PRESENTE") return (actividades[f.employeeId] ?? "") !== (f.activity ?? "");
    return false;
  });
  const cambios = pendientes.length;

  /** A quiénes se acaba de marcar como que vinieron y todavía no dicen qué hicieron. */
  const presentesSinActividad = pendientes.filter(
    (f) => marcas[f.employeeId] === "PRESENTE" && !(actividades[f.employeeId] ?? "").trim(),
  );

  /** Le pone la misma actividad a todos los que vinieron y no tienen una escrita. */
  const aplicarActividadComun = () => {
    const texto = actividadComun.trim();
    if (!texto) return;
    setActividades((a) => {
      const siguiente = { ...a };
      for (const f of filas) {
        if (marcas[f.employeeId] === "PRESENTE" && !(siguiente[f.employeeId] ?? "").trim()) {
          siguiente[f.employeeId] = texto;
        }
      }
      return siguiente;
    });
    setFaltantes(new Set());
    setActividadComun("");
  };

  const marcarTodos = (estado: Estado) =>
    setMarcas(Object.fromEntries(filas.map((f) => [f.employeeId, estado])));

  const guardar = () => {
    const fd = new FormData();
    fd.set("day", dia);
    let marcados = 0;
    for (const f of pendientes) {
      const m = marcas[f.employeeId];
      if (!m) continue;
      fd.set(`estado_${f.employeeId}`, m);
      if (m === "JUSTIFICADO") fd.set(`motivo_${f.employeeId}`, motivos[f.employeeId] ?? "");
      if (m === "PRESENTE") fd.set(`actividad_${f.employeeId}`, actividades[f.employeeId] ?? "");
      marcados++;
    }
    if (marcados === 0) {
      notify("error", "No hay nada nuevo que guardar.");
      return;
    }
    // Se avisa aquí, antes de mandar nada: el servidor lo rechaza igual, pero así los
    // campos que faltan quedan señalados en la pantalla y no hay que buscarlos.
    if (presentesSinActividad.length > 0) {
      setFaltantes(new Set(presentesSinActividad.map((f) => f.employeeId)));
      notify("error", presentesSinActividad.length === 1
        ? `Falta la actividad de ${presentesSinActividad[0].nombre}.`
        : `Falta la actividad de ${presentesSinActividad.length} trabajadores que vinieron.`);
      return;
    }
    setFaltantes(new Set());
    start(async () => {
      const res = await saveAttendance(fd);
      notify(res.ok ? "success" : "error", res.message);
      if (res.ok) router.refresh();
    });
  };

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-steel-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          <span><strong className="text-emerald-700">{cuentas.PRESENTE}</strong> vinieron</span>
          <span><strong className="text-red-700">{cuentas.FALTA}</strong> faltaron</span>
          <span><strong className="text-[#7A5A00]">{cuentas.JUSTIFICADO}</strong> justificados</span>
          <span className={cn(cuentas.sinMarcar > 0 ? "text-steel-600" : "text-steel-400")}>
            <strong>{cuentas.sinMarcar}</strong> sin marcar
          </span>
        </div>

        {puedeMarcar && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => marcarTodos("PRESENTE")}
              className="rounded-md border border-steel-300 bg-white px-3 py-1.5 text-sm text-steel-600 hover:border-emerald-600 hover:text-emerald-700"
            >
              Marcar a todos como que vinieron
            </button>
            <Button onClick={guardar} loading={guardando} disabled={cambios === 0}>
              {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {cambios === 0 ? "Sin cambios" : `Guardar la lista (${cambios})`}
            </Button>
          </div>
        )}
      </div>

      {/* Cuando la cuadrilla entera hizo lo mismo, escribirlo veinte veces sobra. Aparece
          solo mientras haya presentes sin actividad, que es cuando sirve de algo. */}
      {puedeMarcar && presentesSinActividad.length > 1 && (
        <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-steel-200 bg-steel-50 px-4 py-3">
          <label className="min-w-[14rem] flex-1 text-sm">
            <span className="block text-xs text-steel-500">
              Misma actividad para los {presentesSinActividad.length} que vinieron y están sin detallar
            </span>
            <input
              value={actividadComun}
              onChange={(e) => setActividadComun(e.target.value)}
              maxLength={250}
              placeholder="Descarga de mercadería en almacén central"
              className="mt-1 w-full rounded-md border border-steel-300 px-2.5 py-1.5 text-sm"
            />
          </label>
          <Button variant="outline" onClick={aplicarActividadComun} disabled={!actividadComun.trim()}>
            Ponérsela a todos
          </Button>
        </div>
      )}

      <TableShell>
        <thead>
          <tr>
            <Th>Trabajador</Th>
            <Th className="hidden lg:table-cell">Cargo y área</Th>
            <Th>Asistencia</Th>
            <Th>Actividad o motivo</Th>
            <Th className="hidden xl:table-cell">Lo marcó</Th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => {
            const marca = marcas[f.employeeId] ?? null;
            return (
              <Tr
                key={f.employeeId}
                tone={marca === "FALTA" ? "bg-red-50 hover:bg-red-100/70"
                  : marca === "JUSTIFICADO" ? "bg-brand-soft hover:bg-[#FFEBA8]" : ""}
              >
                <Td>
                  <span className="font-semibold">{f.nombre}</span>
                  <p className="text-xs text-steel-500">DNI {f.dni}</p>
                </Td>
                <Td className="hidden text-sm text-steel-600 lg:table-cell">
                  {f.position}
                  <p className="text-xs text-steel-500">{f.area}</p>
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {BOTONES.map((b) => {
                      const Icono = b.icono;
                      const activo = marca === b.valor;
                      return (
                        <button
                          key={b.valor}
                          type="button"
                          disabled={!puedeMarcar}
                          aria-pressed={activo}
                          title={b.etiqueta}
                          onClick={() => setMarcas((m) => ({
                            ...m,
                            [f.employeeId]: m[f.employeeId] === b.valor ? null : b.valor,
                          }))}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-sm transition-colors",
                            activo ? b.activo : "border-steel-300 bg-white text-steel-600 hover:border-steel-400 hover:text-ink",
                            !puedeMarcar && "cursor-not-allowed opacity-60",
                          )}
                        >
                          <Icono className="h-4 w-4" aria-hidden />
                          <span className="hidden sm:inline">{b.etiqueta}</span>
                        </button>
                      );
                    })}
                  </div>
                </Td>
                <Td>
                  {marca === "PRESENTE" ? (
                    <>
                      <input
                        value={actividades[f.employeeId] ?? ""}
                        onChange={(e) => {
                          setActividades((a) => ({ ...a, [f.employeeId]: e.target.value }));
                          if (faltantes.has(f.employeeId)) {
                            setFaltantes((s) => {
                              const n = new Set(s);
                              n.delete(f.employeeId);
                              return n;
                            });
                          }
                        }}
                        maxLength={250}
                        disabled={!puedeMarcar}
                        aria-invalid={faltantes.has(f.employeeId)}
                        aria-label={`Actividad de ${f.nombre}`}
                        placeholder="Descarga de mercadería, apoyo en despacho…"
                        className={cn(
                          "w-full min-w-[12rem] rounded-md border px-2.5 py-1.5 text-sm",
                          faltantes.has(f.employeeId)
                            ? "border-red-500 bg-red-50 placeholder:text-red-400"
                            : "border-steel-300",
                        )}
                      />
                      {faltantes.has(f.employeeId) && (
                        <p className="mt-1 text-xs font-medium text-red-700">
                          Sin esto no se guarda su asistencia.
                        </p>
                      )}
                    </>
                  ) : marca === "JUSTIFICADO" ? (
                    <input
                      value={motivos[f.employeeId] ?? ""}
                      onChange={(e) => setMotivos((m) => ({ ...m, [f.employeeId]: e.target.value }))}
                      maxLength={160}
                      disabled={!puedeMarcar}
                      aria-label={`Motivo de ${f.nombre}`}
                      placeholder="Permiso, descanso médico, vacaciones…"
                      className="w-full min-w-[12rem] rounded-md border border-steel-300 px-2.5 py-1.5 text-sm"
                    />
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-steel-400">
                      <CircleSlash className="h-3 w-3" aria-hidden /> no aplica en las faltas
                    </span>
                  )}
                </Td>
                <Td className="hidden text-xs text-steel-500 xl:table-cell">
                  {f.status ? (f.recordedByName ?? "—") : <span className="text-steel-400">sin registrar</span>}
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </TableShell>

      {puedeMarcar && filas.length > 8 && (
        <div className="mt-3 flex justify-end">
          <Button onClick={guardar} loading={guardando} disabled={cambios === 0}>
            {cambios === 0 ? "Sin cambios" : `Guardar la lista del ${formatDate(dia)} (${cambios})`}
          </Button>
        </div>
      )}
    </>
  );
}
