"use client";

import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { useEffect, useRef } from "react";

/**
 * El mapa de las rutas (OpenStreetMap con Leaflet).
 *
 * Se carga solo en el navegador: Leaflet trabaja con el DOM. Los íconos se dibujan con
 * HTML (círculos numerados), así no dependen de imágenes que el empaquetador pierda.
 */

export type PinParada = {
  id: string;
  lat: number;
  lng: number;
  titulo: string;
  numero?: number | null;
  color?: string | null;
  aproximada?: boolean;
};

export type LineaRuta = { color: string; puntos: [number, number][] };
export type PinLugar = { lat: number; lng: number; nombre: string; tipo: "CD" | "COCHERA"; porDefecto?: boolean };

type Props = {
  paradas: PinParada[];
  rutas: LineaRuta[];
  lugares: PinLugar[];
  /** Si se puede arrastrar el pin para corregir la ubicación. */
  editable?: boolean;
  onMoverParada?: (id: string, lat: number, lng: number) => void;
  /** Modo "elegir un punto": el próximo clic en el mapa se entrega aquí. */
  onElegirPunto?: ((lat: number, lng: number) => void) | null;
  foco?: string | null;
  onSeleccionar?: (id: string) => void;
};

const LIMA_CENTRO: [number, number] = [-12.1, -76.98];

function icono(L: typeof Leaflet, p: PinParada, seleccionado: boolean) {
  const fondo = p.color ?? (p.aproximada ? "#D97706" : "#334155");
  const borde = seleccionado ? "#000" : "#fff";
  const texto = p.numero != null ? String(p.numero) : p.aproximada ? "?" : "";
  return L.divIcon({
    className: "",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    html: `<div style="width:28px;height:28px;border-radius:9999px;background:${fondo};border:3px solid ${borde};
      box-shadow:0 1px 4px rgba(0,0,0,.45);color:#fff;font:700 12px/22px system-ui,sans-serif;text-align:center;
      ${p.aproximada ? "outline:2px dashed #D97706;outline-offset:2px;" : ""}">${texto}</div>`,
  });
}

function iconoLugar(L: typeof Leaflet, l: PinLugar) {
  const fondo = l.tipo === "CD" ? "#FFC20E" : "#111827";
  const color = l.tipo === "CD" ? "#000" : "#FFC20E";
  const letra = l.tipo === "CD" ? "CD" : "P";
  return L.divIcon({
    className: "",
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<div style="width:34px;height:34px;border-radius:8px;background:${fondo};border:3px solid #fff;
      box-shadow:0 1px 5px rgba(0,0,0,.5);color:${color};font:800 12px/28px system-ui,sans-serif;text-align:center">${letra}</div>`,
  });
}

export function MapaRutas({ paradas, rutas, lugares, editable, onMoverParada, onElegirPunto, foco, onSeleccionar }: Props) {
  const caja = useRef<HTMLDivElement>(null);
  const mapa = useRef<Leaflet.Map | null>(null);
  const L = useRef<typeof Leaflet | null>(null);
  const capa = useRef<Leaflet.LayerGroup | null>(null);
  const encuadrado = useRef(false);
  const elegir = useRef(onElegirPunto);
  elegir.current = onElegirPunto;

  // Crear el mapa una sola vez.
  useEffect(() => {
    let vivo = true;
    (async () => {
      const lib = await import("leaflet");
      if (!vivo || !caja.current || mapa.current) return;
      L.current = lib;
      const m = lib.map(caja.current, { zoomControl: true, attributionControl: true }).setView(LIMA_CENTRO, 11);
      lib.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(m);
      capa.current = lib.layerGroup().addTo(m);
      m.on("click", (ev: Leaflet.LeafletMouseEvent) => elegir.current?.(ev.latlng.lat, ev.latlng.lng));
      mapa.current = m;
      // Forzar el dibujo de lo que ya había.
      setTimeout(() => m.invalidateSize(), 50);
      dibujar();
    })();
    return () => {
      vivo = false;
      mapa.current?.remove();
      mapa.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function dibujar() {
    const lib = L.current;
    const m = mapa.current;
    const g = capa.current;
    if (!lib || !m || !g) return;
    g.clearLayers();
    for (const r of rutas) {
      if (r.puntos.length < 2) continue;
      lib.polyline(r.puntos, { color: "#fff", weight: 8, opacity: 0.9 }).addTo(g);
      lib.polyline(r.puntos, { color: r.color, weight: 5, opacity: 0.9 }).addTo(g);
    }
    for (const l of lugares) {
      lib.marker([l.lat, l.lng], { icon: iconoLugar(lib, l), zIndexOffset: 1000, keyboard: false })
        .bindTooltip(`${l.nombre}${l.porDefecto ? " (aproximado: ubícalo en el mapa)" : ""}`)
        .addTo(g);
    }
    for (const p of paradas) {
      const mk = lib.marker([p.lat, p.lng], {
        icon: icono(lib, p, foco === p.id),
        draggable: !!editable,
        title: p.titulo,
        zIndexOffset: foco === p.id ? 900 : 0,
      }).bindTooltip(p.titulo).addTo(g);
      mk.on("click", () => onSeleccionar?.(p.id));
      if (editable) {
        mk.on("dragend", () => {
          const ll = mk.getLatLng();
          onMoverParada?.(p.id, ll.lat, ll.lng);
        });
      }
    }
    // Encuadrar todo la primera vez que hay algo que mostrar.
    if (!encuadrado.current) {
      const todos: [number, number][] = [...paradas.map((p) => [p.lat, p.lng] as [number, number]), ...lugares.map((l) => [l.lat, l.lng] as [number, number])];
      if (todos.length > 1) {
        m.fitBounds(lib.latLngBounds(todos), { padding: [30, 30] });
        encuadrado.current = paradas.length > 0;
      }
    }
  }

  useEffect(dibujar);

  // Al elegir una parada desde la lista, el mapa va hacia ella.
  useEffect(() => {
    const p = paradas.find((x) => x.id === foco);
    if (p && mapa.current) mapa.current.panTo([p.lat, p.lng]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foco]);

  return (
    <div
      ref={caja}
      className={`h-full min-h-[420px] w-full rounded-lg border border-steel-200 ${onElegirPunto ? "cursor-crosshair" : ""}`}
      data-testid="mapa-rutas"
      role="application"
      aria-label="Mapa de las rutas de reparto"
    />
  );
}
