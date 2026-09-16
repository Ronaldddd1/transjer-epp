export default function Loading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-label="Cargando">
      <div className="h-9 w-64 rounded bg-steel-200" />
      <div className="mt-2 h-4 w-96 max-w-full rounded bg-steel-200" />
      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-24 rounded-lg bg-steel-200" />)}
      </div>
    </div>
  );
}
