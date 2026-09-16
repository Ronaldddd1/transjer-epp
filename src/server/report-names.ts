import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { categories, employees, products, users } from "@/db/schema";
import type { ReportFilters } from "./queries";

const isUuid = (v?: string) => !!v && /^[0-9a-f-]{36}$/i.test(v);

/** Nombres legibles de los filtros aplicados, para encabezados de reportes. */
export async function filterNames(f: ReportFilters) {
  const [p, c, e, u] = await Promise.all([
    isUuid(f.productId) ? db.select({ v: products.name, code: products.code }).from(products).where(eq(products.id, f.productId!)) : [],
    isUuid(f.categoryId) ? db.select({ v: categories.name }).from(categories).where(eq(categories.id, f.categoryId!)) : [],
    isUuid(f.employeeId) ? db.select({ v: employees.firstName, l: employees.lastName }).from(employees).where(eq(employees.id, f.employeeId!)) : [],
    isUuid(f.userId) ? db.select({ v: users.name }).from(users).where(eq(users.id, f.userId!)) : [],
  ]);
  return {
    product: p[0] ? `${p[0].code} ${p[0].v}` : undefined,
    category: c[0]?.v,
    employee: e[0] ? `${e[0].v} ${e[0].l}` : undefined,
    user: u[0]?.v,
  };
}
