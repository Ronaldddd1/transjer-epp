import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function TableShell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-lg border border-steel-200 bg-white", className)}>
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left text-[14px]">{children}</table>
      </div>
    </div>
  );
}

export function Th({ className, scope = "col", ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th scope={scope} className={cn("whitespace-nowrap border-b border-steel-200 bg-steel-50 px-3 py-2.5 text-[13px] font-semibold text-steel-600 xl:px-4", className)} {...props} />;
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-b border-steel-100 px-3 py-3 align-middle text-ink-800 xl:px-4", className)} {...props} />;
}

/**
 * Una fila de la tabla.
 *
 * `tone` es para las filas que llevan color por su estado —vencida, por pagar—. Va aparte
 * del className porque esas filas no deben usar el resaltado gris de siempre al pasar el
 * cursor: lo tapaba por completo y el color solo se veía mientras el ratón estuviera en
 * otro lado, que es justo cuando no se está mirando esa fila. Con `tone`, el color manda
 * y el cursor solo lo oscurece un poco.
 */
export function Tr({ children, className, tone }: {
  children: ReactNode;
  className?: string;
  tone?: string;
}) {
  return (
    <tr className={cn(!tone && "hover:bg-steel-50/70", tone, "[&:last-child>td]:border-b-0", className)}>
      {children}
    </tr>
  );
}

export function EmptyRow({ colSpan, title, hint, action }: { colSpan: number; title: string; hint?: string; action?: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-14 text-center">
        <p className="font-display text-lg font-semibold text-ink">{title}</p>
        {hint && <p className="mt-1 text-sm text-steel-500">{hint}</p>}
        {action && <div className="mt-4 flex justify-center">{action}</div>}
      </td>
    </tr>
  );
}
