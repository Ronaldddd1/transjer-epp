import { and, count, eq, sql } from "drizzle-orm";
import { AppShell } from "@/components/layout/app-shell";
import { db } from "@/db";
import { products } from "@/db/schema";
import { requirePageUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  const [{ low }] = await db
    .select({ low: count() })
    .from(products)
    .where(and(eq(products.active, true), sql`${products.stock} <= ${products.minimumStock}`));
  return (
    <AppShell user={{ name: user.name, role: user.role }} lowStockCount={low}>
      {children}
    </AppShell>
  );
}
