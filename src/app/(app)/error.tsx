"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="rounded-lg border border-steel-200 bg-white p-10 text-center">
      <h1 className="font-display text-2xl font-bold">No se pudo cargar esta sección</h1>
      <p className="mt-2 text-steel-500">Revisa tu conexión e inténtalo nuevamente. Si el problema continúa, avisa al administrador.</p>
      <Button className="mt-6" onClick={reset}>Reintentar</Button>
    </div>
  );
}
