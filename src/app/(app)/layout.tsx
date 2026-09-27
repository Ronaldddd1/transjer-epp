import { and, count, eq, sql } from "drizzle-orm";
import { AppShell } from "@/components/layout/app-shell";
import { db } from "@/db";
import { products, supplierInvoices } from "@/db/schema";
import { requirePageUser } from "@/lib/auth";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  const [[low], [pending]] = await Promise.all([
    can(user.role, "products.view")
      ? db.select({ total: count() }).from(products)
          .where(and(eq(products.active, true), sql`${products.stock} <= ${products.minimumStock}`))
      : Promise.resolve([{ total: 0 }]),
    can(user.role, "invoices.view")
      ? db.select({ total: count() }).from(supplierInvoices).where(eq(supplierInvoices.status, "PENDIENTE"))
      : Promise.resolve([{ total: 0 }]),
  ]);
  return (
    <AppShell user={{ name: user.name, role: user.role }} lowStockCount={low?.total ?? 0} pendingInvoices={pending?.total ?? 0}>
      {children}
    </AppShell>
  );
}
