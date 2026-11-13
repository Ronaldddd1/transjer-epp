"use client";

import { CheckCircle2, FileDown, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { Descarga } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Modal } from "./modal";

type Toast = { id: number; kind: "success" | "error"; message: string };
type Ofrecido = { title: string; message: string; descargas: Descarga[] };
const ToastContext = createContext<{
  notify: (kind: Toast["kind"], message: string) => void;
  /** Muestra los documentos para bajar (el cargo, el acta) después de registrar algo. */
  ofrecer: (o: Ofrecido) => void;
} | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Vive aquí, arriba de todo, y no dentro del formulario: al registrar, la pantalla se
  // vuelve a dibujar y la fila desde la que se abrió puede desaparecer (el cesado que ya
  // devolvió todo sale de la lista). El documento tiene que seguir a mano igual.
  const [ofrecido, setOfrecido] = useState<Ofrecido | null>(null);
  const ofrecer = useCallback((o: Ofrecido) => setOfrecido(o), []);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const notify = useCallback((kind: Toast["kind"], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, message }]);
    setTimeout(() => dismiss(id), kind === "error" ? 6000 : 3500);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ notify, ofrecer }}>
      {children}
      <Modal
        open={!!ofrecido}
        onClose={() => setOfrecido(null)}
        title={ofrecido?.title ?? ""}
        footer={<Button variant="outline" onClick={() => setOfrecido(null)}>Cerrar</Button>}
      >
        {ofrecido && (
          <div className="grid gap-4" data-testid="form-listo">
            <p className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {ofrecido.message}
            </p>
            <div className="grid gap-2">
              {ofrecido.descargas.map((d) => (
                <a
                  key={d.href}
                  href={d.href}
                  className="flex items-center gap-3 rounded-lg border border-steel-200 bg-white px-4 py-3 hover:border-ink hover:bg-steel-50"
                >
                  <FileDown className="h-5 w-5 shrink-0 text-ink" aria-hidden />
                  <span>
                    <span className="block font-semibold text-ink">{d.label}</span>
                    {d.detalle && <span className="block text-sm text-steel-500">{d.detalle}</span>}
                  </span>
                </a>
              ))}
            </div>
          </div>
        )}
      </Modal>
      <div className="pointer-events-none fixed inset-x-3 bottom-3 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-4 sm:items-end" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === "error" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-md border-l-4 bg-ink px-4 py-3 text-sm text-white shadow-lg animate-[rise_160ms_ease-out]",
              t.kind === "success" ? "border-brand" : "border-red-500",
            )}
          >
            {t.kind === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />}
            <p className="flex-1">{t.message}</p>
            <button onClick={() => dismiss(t.id)} aria-label="Cerrar aviso" className="text-steel-400 hover:text-white"><X className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast debe usarse dentro de ToastProvider");
  return ctx;
}
