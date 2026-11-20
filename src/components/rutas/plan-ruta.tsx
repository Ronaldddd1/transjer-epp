"use client";

import { AlertTriangle, ArrowDown, ArrowUp, Crosshair, ExternalLink, FileDown, MapPin, Plus, Route, Shuffle, Truck, Warehouse } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { asignarParada, calcularRutas, guardarLugar, guardarTrazo, moverEnRuta, moverParada, ordenarRuta, ubicarParada } from "@/actions/rutas";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { CALIDAD_LABEL, esAproximada, type Calidad } from "@/lib/rutas/geo";
import { caminoPorCalles, esTrazoRecto } from "@/lib/rutas/trazado";
import { cn, formatDate, formatNumber } from "@/lib/utils";
import type { LineaRuta, PinLugar, PinParada } from "./mapa";

const MapaRutas = dynamic(() => import("./mapa").then((m) => m.MapaRutas), {
  ssr: false,
  loading: () => <div className="grid h-full min-h-[420px] place-items-center rounded-lg border border-steel-200 bg-steel-50 text-sm text-steel-500">Cargando el mapa…</div>,
});

/** Colores de las móviles: distinguibles entre sí y sobre el mapa. */
export const COLORES = ["#2563EB", "#DC2626", "#059669", "#9333EA", "#EA580C", "#0891B2", "#BE185D", "#4D7C0F", "#7C2D12", "#1E3A8A"];

export type ParadaUI = {
  id: string; orders: string[]; customer: string; phone: string | null; address: string; cleanAddress: string;
  reference: string | null; district: string; dispatchType: string | null; agency: string | null; notes: string | null;
  deadline: string | null; kg: string; m3: string; lat: number | null; lng: number | null; geoQuality: string | null;
  planVehicleId: string | null; sequence: number | null;
};
export type MovilUI = {
  id: string; plate: string; position: number; capacityKg: string | null; capacityM3: string | null; maxStops: number | null;
  km: string | null; minutes: number | null; loadKg: string | null; loadM3: string | null; geometry: [number, number][] | null;
};
export type FlotaUI = { id: string; plate: string; description: string | null; capacityTn: string | null; capacityM3: string | null; driver: string | null };
type LugarUI = { lat: number; lng: number; name: string; address: string | null; porDefecto?: boolean };

const TONO: Record<Calidad, BadgeTone> = {
  EXACTA: "green", CALLE: "green", MANUAL: "blue", ZONA: "yellow", DISTRITO: "yellow", SIN_UBICAR: "red",
};

const horas = (min: number) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;

/** Enlaces de Google Maps para navegar la ruta (máximo 9 paradas intermedias por enlace). */
export function enlacesGoogle(puntos: { lat: number; lng: number }[]) {
  const ll = (p: { lat: number; lng: number }) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  const tramos: string[] = [];
  let i = 0;
  while (i < puntos.length - 1) {
    const fin = Math.min(i + 10, puntos.length - 1);
    const medio = puntos.slice(i + 1, fin);
    const u = new URL("https://www.google.com/maps/dir/");
    u.searchParams.set("api", "1");
    u.searchParams.set("origin", ll(puntos[i]));
    u.searchParams.set("destination", ll(puntos[fin]));
    if (medio.length) u.searchParams.set("waypoints", medio.map(ll).join("|"));
    u.searchParams.set("travelmode", "driving");
    tramos.push(u.toString());
    i = fin;
  }
  return tramos;
}

export function PlanRuta({ plan, paradas: inicial, moviles, centro, cochera, flota, canManage, servidoresOsrm }: {
  plan: { id: string; serviceDate: string; status: string; totalKm: string | null; exitKm: string | null; approximate: boolean; serviceMinutes: number };
  paradas: ParadaUI[];
  moviles: MovilUI[];
  centro: LugarUI;
  cochera: LugarUI | null;
  flota: FlotaUI[];
  canManage: boolean;
  /** Dónde pedir el camino por las calles desde el navegador. */
  servidoresOsrm: string[];
}) {
  const router = useRouter();
  const { notify } = useToast();
  const [paradas, setParadas] = useState(inicial);
  const [foco, setFoco] = useState<string | null>(null);
  const [eligiendo, setEligiendo] = useState<null | { tipo: "CD" | "COCHERA" } | { tipo: "PARADA"; id: string }>(null);
  const [pestaña, setPestaña] = useState<"paradas" | "rutas">(plan.status === "CALCULADA" ? "rutas" : "paradas");
  const [ubicando, setUbicando] = useState(0);
  const [pending, start] = useTransition();
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [terceros, setTerceros] = useState<number[]>([]);
  const yaUbico = useRef(false);

  useEffect(() => setParadas(inicial), [inicial]);

  // Ubicar en el mapa las paradas que todavía no tienen punto, una por una (el buscador
  // de OpenStreetMap admite una consulta por segundo).
  // Se lanza una sola vez al abrir el plan. No depende de los datos que llegan del
  // servidor: si mientras tanto se ubica la cochera (y la página se refresca), sigue
  // con las que faltan en vez de cortarse a la mitad.
  const montado = useRef(true);
  useEffect(() => () => { montado.current = false; }, []);
  useEffect(() => {
    if (!canManage || yaUbico.current) return;
    const faltan = inicial.filter((p) => p.lat == null && p.geoQuality !== "SIN_UBICAR");
    if (!faltan.length) return;
    yaUbico.current = true;
    (async () => {
      for (let i = 0; i < faltan.length && montado.current; i++) {
        setUbicando(faltan.length - i);
        const r = await ubicarParada(faltan[i].id);
        if (!montado.current) return;
        setParadas((ps) => ps.map((p) => p.id === faltan[i].id
          ? { ...p, lat: r.lat ?? p.lat, lng: r.lng ?? p.lng, geoQuality: r.calidad ?? (r.ok ? p.geoQuality : "SIN_UBICAR") }
          : p));
      }
      if (montado.current) { setUbicando(0); router.refresh(); }
    })();
  }, [inicial, canManage, router]);

  const moviPorId = useMemo(() => new Map(moviles.map((m) => [m.id, m])), [moviles]);
  const calculada = plan.status === "CALCULADA" && moviles.some((m) => m.km != null);

  // Una ruta que quedó en línea recta (el servidor no obtuvo las calles al calcular) se
  // pide de nuevo desde aquí, se dibuja por las calles y se guarda con sus km reales.
  const [trazos, setTrazos] = useState<Record<string, [number, number][]>>({});
  const [trazando, setTrazando] = useState(false);
  const pedidos = useRef(new Set<string>());
  useEffect(() => {
    if (!calculada) return;
    const rectas = moviles.filter((m) => !pedidos.current.has(m.id)
      && esTrazoRecto(m.geometry, inicial.filter((p) => p.planVehicleId === m.id).length));
    if (!rectas.length) return;
    rectas.forEach((m) => pedidos.current.add(m.id));
    (async () => {
      setTrazando(true);
      let guardados = 0;
      for (const m of rectas) {
        try {
          const c = await caminoPorCalles(servidoresOsrm, m.geometry!);
          if (!montado.current) return;
          setTrazos((t) => ({ ...t, [m.id]: c.linea }));
          if (canManage && (await guardarTrazo(m.id, c)).ok) guardados++;
        } catch {
          // Sin respuesta tampoco desde aquí: queda en línea recta (y dice «aproximado»).
        }
      }
      if (!montado.current) return;
      setTrazando(false);
      if (guardados) router.refresh();
    })();
  }, [calculada, moviles, inicial, servidoresOsrm, canManage, router]);

  const pins: PinParada[] = paradas.filter((p) => p.lat != null && p.lng != null).map((p) => {
    const m = p.planVehicleId ? moviPorId.get(p.planVehicleId) : null;
    return {
      id: p.id, lat: p.lat!, lng: p.lng!,
      titulo: `${p.sequence ? `${p.sequence}. ` : ""}${p.customer} — ${p.cleanAddress}, ${p.district}`,
      numero: calculada ? p.sequence : null,
      color: calculada && m ? COLORES[m.position % COLORES.length] : null,
      aproximada: esAproximada(p.geoQuality),
    };
  });
  const lineas: LineaRuta[] = calculada
    ? moviles.filter((m) => m.geometry?.length).map((m) => ({ color: COLORES[m.position % COLORES.length], puntos: trazos[m.id] ?? m.geometry! }))
    : [];
  const lugares: PinLugar[] = [
    { ...centro, nombre: centro.name, tipo: "CD", porDefecto: centro.porDefecto },
    ...(cochera ? [{ ...cochera, nombre: cochera.name, tipo: "COCHERA" as const }] : []),
  ];

  const aproximadas = paradas.filter((p) => esAproximada(p.geoQuality));
  const kgTotal = paradas.reduce((s, p) => s + Number(p.kg), 0);
  const m3Total = paradas.reduce((s, p) => s + Number(p.m3), 0);

  function alElegir(lat: number, lng: number) {
    const e = eligiendo;
    if (!e) return;
    setEligiendo(null);
    if (e.tipo === "PARADA") return mover(e.id, lat, lng);
    start(async () => {
      const r = await guardarLugar(e.tipo, lat, lng, "");
      notify(r.ok ? "success" : "error", r.message);
      if (r.ok) router.refresh();
    });
  }

  function mover(id: string, lat: number, lng: number) {
    setParadas((ps) => ps.map((p) => (p.id === id ? { ...p, lat, lng, geoQuality: "MANUAL" } : p)));
    start(async () => {
      const r = await moverParada(id, lat, lng);
      notify(r.ok ? "success" : "error", r.message);
      router.refresh();
    });
  }

  function calcular(fd: FormData) {
    setErrores({});
    start(async () => {
      const r = await calcularRutas(plan.id, fd);
      notify(r.ok ? "success" : "error", r.message);
      if (!r.ok) setErrores(r.fieldErrors ?? {});
      else { setPestaña("rutas"); router.refresh(); }
    });
  }

  const paradasDe = (m: MovilUI) => paradas.filter((p) => p.planVehicleId === m.id).sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  const sinMovil = calculada ? paradas.filter((p) => !p.planVehicleId) : [];

  // Ajuste a mano: pasar una parada a otra móvil, cambiar el orden u ordenar una ruta.
  const [ajustando, setAjustando] = useState<string | null>(null);
  function ajustar(clave: string, accion: () => Promise<{ ok: boolean; message?: string }>) {
    setAjustando(clave);
    start(async () => {
      const r = await accion();
      setAjustando(null);
      notify(r.ok && !r.message?.includes("Ojo:") ? "success" : "error", r.message ?? (r.ok ? "Listo." : "No se pudo."));
      if (r.ok) router.refresh();
    });
  }
  const selectorMovil = (p: ParadaUI) => canManage && (
    <select
      aria-label={`Pasar ${p.customer} a otra móvil`}
      value={p.planVehicleId ?? ""}
      disabled={pending}
      onChange={(ev) => ajustar(p.id, () => asignarParada(p.id, ev.target.value || null))}
      className="h-7 rounded border border-steel-300 bg-white px-1 text-xs"
      data-testid="pasar-a"
    >
      {moviles.map((m) => <option key={m.id} value={m.id}>{m.plate}</option>)}
      <option value="">Sin móvil</option>
    </select>
  );

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_440px]">
      {/* El mapa se queda a la vista mientras se recorre la lista de la derecha. Los avisos
          y los botones van ENCIMA del mapa: si se insertaran arriba, la página saltaría y
          el mapa se iría de la pantalla justo cuando hay que hacer clic en él. */}
      <div className="grid content-start gap-3 xl:sticky xl:top-4">
        <div className="relative h-[68vh] min-h-[440px]">
          <div className="pointer-events-none absolute inset-x-3 top-3 z-[1000] grid justify-items-center gap-2">
            {eligiendo && (
              <p className="pointer-events-auto flex items-center gap-3 rounded-lg bg-ink px-4 py-2.5 text-sm text-white shadow-lg" data-testid="eligiendo">
                <Crosshair className="h-4 w-4 shrink-0" />
                Haz clic en el mapa donde está {eligiendo.tipo === "CD" ? "el centro de recojo" : eligiendo.tipo === "COCHERA" ? "la cochera" : "esta entrega"}.
                <button type="button" className="font-semibold text-brand underline" onClick={() => setEligiendo(null)}>Cancelar</button>
              </p>
            )}
            {ubicando > 0 && !eligiendo && (
              <p className="rounded-lg border border-steel-200 bg-white/95 px-4 py-2 text-sm text-steel-700 shadow" data-testid="ubicando">
                Ubicando las direcciones… faltan {ubicando} (una por segundo).
              </p>
            )}
            {trazando && !eligiendo && (
              <p className="rounded-lg border border-steel-200 bg-white/95 px-4 py-2 text-sm text-steel-700 shadow" data-testid="trazando">
                Trazando las rutas por las calles…
              </p>
            )}
          </div>
          {canManage && (
            <div className="absolute bottom-8 right-3 z-[1000] grid gap-1.5">
              <Button size="sm" variant="outline" className="shadow" onClick={() => setEligiendo({ tipo: "CD" })}><Warehouse className="h-4 w-4" /> Ubicar centro</Button>
              <Button size="sm" variant={cochera ? "outline" : "primary"} className="shadow" onClick={() => setEligiendo({ tipo: "COCHERA" })}><MapPin className="h-4 w-4" /> Ubicar cochera</Button>
            </div>
          )}
          <MapaRutas
            paradas={pins}
            rutas={lineas}
            lugares={lugares}
            editable={canManage && !eligiendo}
            onMoverParada={mover}
            onElegirPunto={eligiendo ? alElegir : null}
            foco={foco}
            onSeleccionar={(id) => {
              setFoco(id);
              // En «Móviles y rutas» se queda ahí y marca la entrega en su ruta (para pasarla
              // a otra móvil); si no, va a la lista de paradas.
              const enRutas = document.getElementById(`ruta-parada-${id}`);
              if (pestaña === "rutas" && enRutas) enRutas.scrollIntoView({ block: "nearest" });
              else { setPestaña("paradas"); document.getElementById(`parada-${id}`)?.scrollIntoView({ block: "nearest" }); }
            }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-steel-600">
          <span className="flex items-center gap-1.5"><span className="inline-block h-4 w-6 rounded bg-brand text-center text-[10px] font-bold leading-4 text-ink">CD</span> {centro.name}{centro.porDefecto && <em className="text-amber-700"> (aproximado)</em>}</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-4 w-6 rounded bg-ink text-center text-[10px] font-bold leading-4 text-brand">P</span> {cochera ? "Cochera" : <em className="text-red-700">Cochera sin ubicar</em>}</span>
          <span>Arrastra un punto para corregir su ubicación; se recordará para la próxima vez.</span>
        </div>
      </div>

      <aside className="grid content-start gap-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border border-steel-200 bg-white p-2"><p className="text-xs text-steel-500">Paradas</p><p className="font-display text-xl font-bold">{paradas.length}</p></div>
          <div className="rounded-lg border border-steel-200 bg-white p-2"><p className="text-xs text-steel-500">Peso</p><p className="font-display text-xl font-bold tabular">{formatNumber(Math.round(kgTotal))} kg</p></div>
          <div className="rounded-lg border border-steel-200 bg-white p-2"><p className="text-xs text-steel-500">Volumen</p><p className="font-display text-xl font-bold tabular">{m3Total.toFixed(2)} m³</p></div>
        </div>

        <div role="tablist" className="grid grid-cols-2 rounded-lg border border-steel-200 bg-steel-50 p-1 text-sm font-semibold">
          {(["paradas", "rutas"] as const).map((t) => (
            <button key={t} role="tab" type="button" aria-selected={pestaña === t} onClick={() => setPestaña(t)}
              className={cn("rounded-md px-3 py-1.5", pestaña === t ? "bg-white text-ink shadow-sm" : "text-steel-500 hover:text-ink")}>
              {t === "paradas" ? `Paradas${aproximadas.length ? ` · ${aproximadas.length} por revisar` : ""}` : calculada ? `Rutas · ${formatNumber(Number(plan.totalKm ?? 0))} km` : "Móviles y rutas"}
            </button>
          ))}
        </div>

        {pestaña === "paradas" && (
          <div className="grid gap-2">
            {aproximadas.length > 0 && (
              <p className="flex items-start gap-2 rounded-md border border-brand/60 bg-brand-soft px-3 py-2 text-sm text-[#7A5A00]">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{aproximadas.length} dirección(es) quedaron solo por la zona o el distrito (punto con «?»). Revisa y arrastra el punto a su sitio: cambia los km.</span>
              </p>
            )}
            <ul className="grid max-h-[60vh] gap-1.5 overflow-auto pr-1" data-testid="lista-paradas">
              {paradas.map((p) => {
                const q = (p.geoQuality ?? (p.lat == null ? "SIN_UBICAR" : "CALLE")) as Calidad;
                const m = p.planVehicleId ? moviPorId.get(p.planVehicleId) : null;
                return (
                  <li key={p.id} id={`parada-${p.id}`}
                    className={cn("cursor-pointer rounded-lg border bg-white px-3 py-2 text-sm", foco === p.id ? "border-ink" : "border-steel-200 hover:border-steel-400")}
                    onClick={() => setFoco(p.id)}>
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold leading-tight">
                        {calculada && m && <span className="mr-1.5 inline-grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold text-white" style={{ background: COLORES[m.position % COLORES.length] }}>{p.sequence}</span>}
                        {p.customer}
                      </p>
                      <Badge tone={TONO[q] ?? "neutral"}>{CALIDAD_LABEL[q] ?? q}</Badge>
                    </div>
                    <p className="text-steel-600">{p.cleanAddress} · {p.district}</p>
                    {p.reference && <p className="text-xs text-steel-500">Ref.: {p.reference}</p>}
                    <p className="text-xs text-steel-500">
                      Pedido {p.orders.join(", ")} · {Number(p.kg).toFixed(1)} kg · {Number(p.m3).toFixed(3)} m³
                      {p.deadline && <> · entrega hasta {formatDate(p.deadline)}</>}
                      {p.agency && p.agency.trim() && <> · agencia {p.agency}</>}
                    </p>
                    {canManage && (q === "SIN_UBICAR" || esAproximada(q)) && (
                      <button type="button" className="mt-1 text-xs font-semibold text-ink underline"
                        onClick={(ev) => { ev.stopPropagation(); setEligiendo({ tipo: "PARADA", id: p.id }); }}>
                        Ubicar en el mapa
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {pestaña === "rutas" && (
          <div className="grid gap-3">
            {calculada && (
              <div className="grid gap-2" data-testid="resultado-rutas">
                {plan.approximate && (
                  <p className="rounded-md border border-brand/60 bg-brand-soft px-3 py-2 text-sm text-[#7A5A00]">
                    No se pudo consultar las calles: los km son una estimación en línea recta (×1.35).
                  </p>
                )}
                {sinMovil.length > 0 && (
                  <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" data-testid="sin-movil">
                    <p>{sinMovil.length} parada(s) sin móvil{canManage ? ": elige a cuál pasarlas." : "."}</p>
                    <ul className="mt-1 grid gap-1">
                      {sinMovil.map((p) => (
                        <li key={p.id} className="flex items-center justify-between gap-2 text-steel-800">
                          <span><span className="font-medium">{p.customer}</span> <span className="text-steel-500">· {p.district}</span></span>
                          {selectorMovil(p)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {canManage && (
                  <p className="text-xs text-steel-500">
                    Puedes ajustar a mano: con «Pasar a» cambias una entrega de móvil (entra donde menos recorrido agrega),
                    con las flechas cambias el orden, y «Ordenar» vuelve a ordenar esa ruta sola. Los km y el tiempo se
                    rehacen en el momento. «Recalcular rutas» vuelve a repartir todo automáticamente.
                  </p>
                )}
                {moviles.map((m) => {
                  const ps = paradasDe(m);
                  const color = COLORES[m.position % COLORES.length];
                  const pct = (carga: string | null, cap: string | null) => (cap ? Math.round((Number(carga ?? 0) / Number(cap)) * 100) : null);
                  const enlaces = enlacesGoogle([centro, ...ps.map((p) => ({ lat: p.lat!, lng: p.lng! })), ...(cochera ? [cochera] : [])]);
                  return (
                    <section key={m.id} className="rounded-lg border border-steel-200 bg-white" data-testid="movil-ruta">
                      <header className="flex items-center justify-between gap-2 border-b border-steel-100 px-3 py-2" style={{ borderLeft: `6px solid ${color}` }}>
                        <p className="flex items-center gap-2 font-semibold"><Truck className="h-4 w-4" /> {m.plate}</p>
                        <div className="flex items-center gap-2">
                          {canManage && ps.length > 1 && (
                            <button type="button" disabled={pending} onClick={() => ajustar(m.id, () => ordenarRuta(m.id))}
                              className="inline-flex items-center gap-1 rounded border border-steel-300 px-1.5 py-0.5 text-xs font-medium text-steel-700 hover:border-ink disabled:opacity-50"
                              title="Ordenar esta ruta por el menor recorrido (con sus mismas entregas)">
                              <Shuffle className="h-3 w-3" /> {ajustando === m.id ? "Ordenando…" : "Ordenar"}
                            </button>
                          )}
                          {m.km != null ? (
                            <p className="text-right text-sm" title="Km desde que sale de la cochera. Tiempo desde que sale del centro de recojo hasta que vuelve a la cochera"><strong className="tabular">{Number(m.km).toFixed(1)} km</strong> · {horas(m.minutes ?? 0)}</p>
                          ) : (
                            <p className="text-sm text-steel-500">Sin entregas</p>
                          )}
                        </div>
                      </header>
                      <div className="px-3 py-2 text-xs text-steel-600">
                        {ps.length} parada(s){m.maxStops != null && ps.length > m.maxStops && <span className="font-semibold text-red-700"> (tope {m.maxStops})</span>}
                        {" · "}<span className={cn((pct(m.loadKg, m.capacityKg) ?? 0) > 100 && "font-semibold text-red-700")}>{Number(m.loadKg ?? 0).toFixed(1)} kg{pct(m.loadKg, m.capacityKg) != null && ` (${pct(m.loadKg, m.capacityKg)} %)`}</span>
                        {" · "}<span className={cn((pct(m.loadM3, m.capacityM3) ?? 0) > 100 && "font-semibold text-red-700")}>{Number(m.loadM3 ?? 0).toFixed(2)} m³{pct(m.loadM3, m.capacityM3) != null && ` (${pct(m.loadM3, m.capacityM3)} %)`}</span>
                      </div>
                      <ol className="grid gap-0.5 px-3 pb-2 text-sm">
                        <li className="text-xs text-steel-500" data-testid="tramo-salida">
                          Sale de la cochera → {centro.name}{plan.exitKm != null && <>: {Number(plan.exitKm).toFixed(1)} km (suman en los km; no se dibujan ni cuentan en el tiempo)</>}
                        </li>
                        {ps.map((p, k) => (
                          <li key={p.id} id={`ruta-parada-${p.id}`} className={cn("flex items-start gap-2 rounded px-1 py-0.5", foco === p.id && "bg-brand-soft", ajustando === p.id && "opacity-50")} data-testid="parada-ruta">
                            <span className="mt-0.5 inline-grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white" style={{ background: color }}>{p.sequence}</span>
                            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setFoco(p.id)}>
                              <span className="font-medium">{p.customer}</span> <span className="text-steel-500">· {p.district}</span>
                            </button>
                            {canManage && (
                              <span className="flex shrink-0 items-center gap-1">
                                <button type="button" aria-label={`Subir ${p.customer}`} disabled={pending || k === 0}
                                  onClick={() => ajustar(p.id, () => moverEnRuta(p.id, -1))}
                                  className="grid h-7 w-6 place-items-center rounded border border-steel-300 text-steel-600 hover:border-ink disabled:opacity-30">
                                  <ArrowUp className="h-3.5 w-3.5" />
                                </button>
                                <button type="button" aria-label={`Bajar ${p.customer}`} disabled={pending || k === ps.length - 1}
                                  onClick={() => ajustar(p.id, () => moverEnRuta(p.id, 1))}
                                  className="grid h-7 w-6 place-items-center rounded border border-steel-300 text-steel-600 hover:border-ink disabled:opacity-30">
                                  <ArrowDown className="h-3.5 w-3.5" />
                                </button>
                                {selectorMovil(p)}
                              </span>
                            )}
                          </li>
                        ))}
                        <li className="text-xs text-steel-500">Vuelve a la cochera</li>
                      </ol>
                      <div className="flex flex-wrap gap-2 border-t border-steel-100 px-3 py-2">
                        {enlaces.map((u, i) => (
                          <a key={u} href={u} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-ink underline">
                            <ExternalLink className="h-3.5 w-3.5" /> Google Maps{enlaces.length > 1 ? ` (tramo ${i + 1})` : ""}
                          </a>
                        ))}
                      </div>
                    </section>
                  );
                })}
                <a href={`/api/rutas/${plan.id}/excel`} className="inline-flex items-center justify-center gap-2 rounded-md border border-steel-300 bg-white px-4 py-2 text-sm font-semibold text-ink hover:border-ink">
                  <FileDown className="h-4 w-4" /> Descargar hojas de ruta (Excel)
                </a>
              </div>
            )}

            {canManage && (
              <form action={calcular} className="grid gap-3 rounded-lg border border-steel-200 bg-white p-3" data-testid="form-moviles">
                <p className="font-semibold">{calculada ? "Volver a calcular" : "Móviles del día"}</p>
                {!cochera && <p className="text-sm text-red-700">Antes, ubica la cochera en el mapa («Ubicar cochera»): ahí termina cada ruta.</p>}
                <p className="text-xs text-steel-500">Marca las que salen. La capacidad viene de su ficha; cámbiala si ese día va con otra carga. «Máx.» es el tope de entregas acordado (vacío = sin tope).</p>
                {errores.moviles && <p className="text-sm text-red-700">{errores.moviles}</p>}
                <div className="max-h-72 overflow-auto rounded-md border border-steel-100">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-steel-50 text-xs text-steel-500">
                      <tr><th className="px-2 py-1.5 text-left">Móvil</th><th className="px-1 py-1.5">Kg</th><th className="px-1 py-1.5">m³</th><th className="px-1 py-1.5">Máx.</th></tr>
                    </thead>
                    <tbody>
                      {flota.map((v) => {
                        const antes = moviles.find((m) => m.plate === v.plate);
                        return (
                          <tr key={v.id} className="border-t border-steel-100">
                            <td className="px-2 py-1">
                              <label className="flex items-center gap-2">
                                <input type="checkbox" name={`usar_${v.id}`} defaultChecked={!!antes} />
                                <input type="hidden" name={`placa_${v.id}`} value={v.plate} />
                                <span><span className="font-semibold">{v.plate}</span>{v.driver && <span className="block text-xs text-steel-500">{v.driver}</span>}</span>
                              </label>
                            </td>
                            <td className="px-1"><input name={`kg_${v.id}`} inputMode="decimal" aria-label={`Capacidad en kg de ${v.plate}`} defaultValue={antes?.capacityKg ? Number(antes.capacityKg) : v.capacityTn ? Number(v.capacityTn) * 1000 : ""} className="h-8 w-20 rounded border border-steel-300 px-1.5 text-right tabular" /></td>
                            <td className="px-1"><input name={`m3_${v.id}`} inputMode="decimal" aria-label={`Capacidad en m³ de ${v.plate}`} defaultValue={antes?.capacityM3 ? Number(antes.capacityM3) : v.capacityM3 ? Number(v.capacityM3) : ""} className="h-8 w-16 rounded border border-steel-300 px-1.5 text-right tabular" /></td>
                            <td className="px-1"><input name={`max_${v.id}`} inputMode="numeric" aria-label={`Máximo de paradas de ${v.plate}`} defaultValue={antes?.maxStops ?? ""} className="h-8 w-12 rounded border border-steel-300 px-1.5 text-right tabular" /></td>
                          </tr>
                        );
                      })}
                      {terceros.map((t) => (
                        <tr key={t} className="border-t border-steel-100 bg-steel-50/60">
                          <td className="px-2 py-1">
                            <label className="flex items-center gap-2">
                              <input type="checkbox" name={`usar_tercero${t}`} defaultChecked />
                              <input name={`placa_tercero${t}`} placeholder="Placa (tercero)" aria-label="Placa de la móvil de tercero" className={cn("h-8 w-28 rounded border px-1.5 uppercase", errores[`placa_tercero${t}`] ? "border-red-500" : "border-steel-300")} />
                            </label>
                          </td>
                          <td className="px-1"><input name={`kg_tercero${t}`} inputMode="decimal" aria-label="Capacidad en kg de la móvil de tercero" className="h-8 w-20 rounded border border-steel-300 px-1.5 text-right" /></td>
                          <td className="px-1"><input name={`m3_tercero${t}`} inputMode="decimal" aria-label="Capacidad en m³ de la móvil de tercero" className="h-8 w-16 rounded border border-steel-300 px-1.5 text-right" /></td>
                          <td className="px-1"><input name={`max_tercero${t}`} inputMode="numeric" aria-label="Máximo de paradas de la móvil de tercero" className="h-8 w-12 rounded border border-steel-300 px-1.5 text-right" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {Object.entries(errores).filter(([k]) => k !== "moviles").length > 0 && (
                  <p className="text-sm text-red-700">{Object.values(errores).filter((_, i) => Object.keys(errores)[i] !== "moviles").join(" · ")}</p>
                )}
                <Button size="sm" variant="ghost" className="justify-self-start" onClick={() => setTerceros((t) => [...t, (t.at(-1) ?? 0) + 1])}><Plus className="h-4 w-4" /> Móvil de tercero</Button>
                <p className="text-xs text-steel-500">
                  Salen todas las móviles que marques. Entre ellas se reparten las entregas para el menor recorrido
                  total: cada ruta en un orden lógico, sin idas y vueltas ni cruces, y cada entrega en la móvil que pasa
                  más cerca (no necesariamente la misma cantidad para cada una).
                </p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                  <label className="flex items-center gap-2">
                    Minutos por entrega
                    <input name="serviceMinutes" inputMode="numeric" defaultValue={plan.serviceMinutes} aria-label="Minutos por entrega" className="h-8 w-14 rounded border border-steel-300 px-1.5 text-right" />
                  </label>
                  <label className="flex items-center gap-2">
                    Jornada máx. (h)
                    <input name="maxHours" inputMode="decimal" defaultValue="9" aria-label="Jornada máxima en horas" className={cn("h-8 w-14 rounded border px-1.5 text-right", errores.maxHours ? "border-red-500" : "border-steel-300")} />
                  </label>
                </div>
                <Button type="submit" loading={pending} disabled={ubicando > 0 || !cochera}>
                  <Route className="h-4 w-4" /> {calculada ? "Recalcular rutas" : "Calcular rutas"}
                </Button>
                {ubicando > 0 && <p className="text-xs text-steel-500">Espera a que terminen de ubicarse las direcciones.</p>}
              </form>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
