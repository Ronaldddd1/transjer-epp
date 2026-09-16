import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="font-display text-4xl font-bold">Página no encontrada</h1>
      <p className="text-steel-500">El enlace no existe o el registro fue eliminado.</p>
      <ButtonLink href="/dashboard" variant="primary">Ir al Dashboard</ButtonLink>
    </main>
  );
}
