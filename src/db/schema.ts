/**
 * Esquema de base de datos — Control de Inventario de EPP (Transjer)
 * Para agregar un rol: añádelo a `roleEnum` y define sus permisos en src/lib/permissions.ts,
 * luego ejecuta `npm run db:generate` y `npm run db:migrate`.
 */
import { relations, sql } from "drizzle-orm";
import {
  boolean, check, date, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid, varchar,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["ADMIN", "USUARIO"]);
export const movementTypeEnum = pgEnum("movement_type", ["ENTRADA", "SALIDA", "AJUSTE"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
};

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 120 }).notNull(),
  username: varchar("username", { length: 50 }).notNull().unique(),
  email: varchar("email", { length: 160 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull().default("USUARIO"),
  active: boolean("active").notNull().default(true),
  ...timestamps,
});

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 80 }).notNull().unique(),
  description: text("description"),
  active: boolean("active").notNull().default(true),
  isDemo: boolean("is_demo").notNull().default(false),
  ...timestamps,
});

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 30 }).notNull().unique(),
  name: varchar("name", { length: 150 }).notNull(),
  categoryId: uuid("category_id").notNull().references(() => categories.id),
  description: text("description"),
  brand: varchar("brand", { length: 80 }),
  size: varchar("size", { length: 20 }),
  color: varchar("color", { length: 40 }),
  unit: varchar("unit", { length: 30 }).notNull().default("Unidad"),
  stock: integer("stock").notNull().default(0),
  minimumStock: integer("minimum_stock").notNull().default(0),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  isDemo: boolean("is_demo").notNull().default(false),
  ...timestamps,
}, (t) => [
  index("products_category_idx").on(t.categoryId),
  index("products_active_name_idx").on(t.active, t.name),
  check("products_stock_non_negative", sql`${t.stock} >= 0`),
  check("products_min_stock_non_negative", sql`${t.minimumStock} >= 0`),
]);

export const employees = pgTable("employees", {
  id: uuid("id").primaryKey().defaultRandom(),
  dni: varchar("dni", { length: 12 }).notNull().unique(),
  firstName: varchar("first_name", { length: 80 }).notNull(),
  lastName: varchar("last_name", { length: 80 }).notNull(),
  position: varchar("position", { length: 80 }).notNull(),
  area: varchar("area", { length: 80 }).notNull(),
  phone: varchar("phone", { length: 20 }),
  hireDate: date("hire_date"),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  isDemo: boolean("is_demo").notNull().default(false),
  ...timestamps,
}, (t) => [index("employees_active_lastname_idx").on(t.active, t.lastName)]);

export const inventoryMovements = pgTable("inventory_movements", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull().references(() => products.id),
  type: movementTypeEnum("type").notNull(),
  /** Entradas y salidas: siempre positiva. Ajustes: positiva o negativa. */
  quantity: integer("quantity").notNull(),
  stockBefore: integer("stock_before").notNull(),
  stockAfter: integer("stock_after").notNull(),
  reason: varchar("reason", { length: 120 }).notNull(),
  employeeId: uuid("employee_id").references(() => employees.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("movements_product_date_idx").on(t.productId, t.createdAt),
  index("movements_type_date_idx").on(t.type, t.createdAt),
  index("movements_user_idx").on(t.userId),
  index("movements_date_idx").on(t.createdAt),
]);

export const eppDeliveries = pgTable("epp_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  productId: uuid("product_id").notNull().references(() => products.id),
  movementId: uuid("movement_id").notNull().unique().references(() => inventoryMovements.id),
  quantity: integer("quantity").notNull(),
  size: varchar("size", { length: 20 }),
  deliveryDate: date("delivery_date").notNull(),
  reason: varchar("reason", { length: 120 }).notNull(),
  userId: uuid("user_id").notNull().references(() => users.id),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("deliveries_employee_date_idx").on(t.employeeId, t.deliveryDate),
  index("deliveries_product_idx").on(t.productId),
  index("deliveries_date_idx").on(t.deliveryDate),
]);

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  userName: varchar("user_name", { length: 120 }),
  action: varchar("action", { length: 30 }).notNull(),
  module: varchar("module", { length: 30 }).notNull(),
  recordId: varchar("record_id", { length: 60 }),
  description: text("description").notNull(),
  oldData: jsonb("old_data"),
  newData: jsonb("new_data"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("audit_module_date_idx").on(t.module, t.createdAt),
  index("audit_user_idx").on(t.userId),
  index("audit_date_idx").on(t.createdAt),
]);

// Relaciones
export const categoriesRelations = relations(categories, ({ many }) => ({ products: many(products) }));
export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  movements: many(inventoryMovements),
  deliveries: many(eppDeliveries),
}));
export const employeesRelations = relations(employees, ({ many }) => ({
  deliveries: many(eppDeliveries),
  movements: many(inventoryMovements),
}));
export const movementsRelations = relations(inventoryMovements, ({ one }) => ({
  product: one(products, { fields: [inventoryMovements.productId], references: [products.id] }),
  employee: one(employees, { fields: [inventoryMovements.employeeId], references: [employees.id] }),
  user: one(users, { fields: [inventoryMovements.userId], references: [users.id] }),
}));
export const deliveriesRelations = relations(eppDeliveries, ({ one }) => ({
  employee: one(employees, { fields: [eppDeliveries.employeeId], references: [employees.id] }),
  product: one(products, { fields: [eppDeliveries.productId], references: [products.id] }),
  movement: one(inventoryMovements, { fields: [eppDeliveries.movementId], references: [inventoryMovements.id] }),
  user: one(users, { fields: [eppDeliveries.userId], references: [users.id] }),
}));
export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  user: one(users, { fields: [auditLogs.userId], references: [users.id] }),
}));

export type User = typeof users.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Employee = typeof employees.$inferSelect;
export type Role = (typeof roleEnum.enumValues)[number];
export type MovementType = (typeof movementTypeEnum.enumValues)[number];
