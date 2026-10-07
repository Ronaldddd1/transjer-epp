import { and, count, eq, inArray, ne, sql } from "drizzle-orm";
import { AppShell } from "@/components/layout/app-shell";
import { db } from "@/db";
import { products, supplierInvoices } from "@/db/schema";
import { requirePageUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { pendingReturnsCount } from "@/server/queries";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  const [[low], [pending], [detracciones], devoluciones] = await Promise.all([
    can(user.role, "products.view")
      ? db.select({ total: count() }).from(products)
          .where(and(eq(products.active, true), sql`${products.stock} <= ${products.minimumStock}`))
      : Promise.resolve([{ total: 0 }]),
    can(user.role, "invoices.view")
      ? db.select({ total: count() }).from(supplierInvoices).where(eq(supplierInvoices.status, "PENDIENTE"))
      : Promise.resolve([{ total: 0 }]),
    can(user.role, "detractions.view")
      ? db.select({ total: count() }).from(supplierInvoices)
          .where(and(inArray(supplierInvoices.detractionStatus, ["PENDIENTE", "EN_PROCESO"]), ne(supplierInvoices.status, "ANULADA")))
      : Promise.resolve([{ total: 0 }]),
    can(user.role, "deliveries.view")
      ? pendingReturnsCount()
      : Promise.resolve({ trabajadores: 0, unidades: 0 }),
  ]);
  return (
    <AppShell
      user={{ name: user.name, role: user.role }}
      lowStockCount={low?.total ?? 0}
      pendingInvoices={pending?.total ?? 0}
      pendingDetractions={detracciones?.total ?? 0}
      pendingReturns={devoluciones.trabajadores}
    >
      {children}
    </AppShell>
  );
}
