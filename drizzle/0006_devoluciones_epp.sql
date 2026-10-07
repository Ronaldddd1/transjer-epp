-- Devolución de EPP al cese del trabajador.
--
-- Todo es aditivo: ninguna entrega existente cambia. Se agrega la fecha y el motivo del
-- cese al trabajador, y la tabla de devoluciones. Lo que un trabajador tiene a su cargo se
-- calcula (entregas vigentes menos devoluciones), así que no hay nada que rellenar:
-- los trabajadores que hoy figuran inactivos siguen igual, sin cese y sin devoluciones.

CREATE TYPE "public"."return_condition" AS ENUM('REUTILIZABLE', 'DESCARTADO', 'NO_DEVUELTO');--> statement-breakpoint
CREATE TABLE "epp_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"size" varchar(20),
	"return_date" date NOT NULL,
	"condition" "return_condition" NOT NULL,
	"movement_id" uuid,
	"reason" varchar(120) NOT NULL,
	"user_id" uuid NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "epp_returns_movement_id_unique" UNIQUE("movement_id"),
	CONSTRAINT "returns_quantity_positive" CHECK ("epp_returns"."quantity" > 0),
	CONSTRAINT "returns_movement_consistent" CHECK (("epp_returns"."condition" = 'REUTILIZABLE') = ("epp_returns"."movement_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "supplier_invoices" ALTER COLUMN "plate" SET DATA TYPE varchar(24);--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "terminated_at" date;--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "termination_reason" varchar(160);--> statement-breakpoint
ALTER TABLE "epp_returns" ADD CONSTRAINT "epp_returns_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epp_returns" ADD CONSTRAINT "epp_returns_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epp_returns" ADD CONSTRAINT "epp_returns_movement_id_inventory_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epp_returns" ADD CONSTRAINT "epp_returns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "returns_employee_idx" ON "epp_returns" USING btree ("employee_id","return_date");--> statement-breakpoint
CREATE INDEX "returns_product_idx" ON "epp_returns" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "returns_date_idx" ON "epp_returns" USING btree ("return_date");--> statement-breakpoint
CREATE INDEX "employees_terminated_idx" ON "employees" USING btree ("terminated_at");