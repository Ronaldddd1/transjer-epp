import type { ReactNode } from "react";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <h1 className="font-display text-[28px] font-bold leading-tight tracking-tight text-ink sm:text-[32px]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[15px] text-steel-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 lg:shrink-0 lg:flex-nowrap">{actions}</div>}
    </div>
  );
}

export function Panel({ title, action, children, className = "" }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-lg border border-steel-200 bg-white ${className}`}>
      {title && (
        <header className="flex items-center justify-between gap-2 border-b border-steel-200 px-4 py-3">
          <h2 className="font-display text-lg font-semibold text-ink">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
