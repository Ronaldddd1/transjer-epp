CREATE TYPE "public"."detraction_status" AS ENUM('NO_APLICA', 'PENDIENTE', 'EN_PROCESO', 'PAGADA', 'OBSERVADA');--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE 'DETRACCIONES';--> statement-breakpoint
ALTER TABLE "suppliers" DROP CONSTRAINT "suppliers_ruc_format";--> statement-breakpoint
ALTER TABLE "suppliers" ALTER COLUMN "ruc" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "contact_name" varchar(120);--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "plate" varchar(24);--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "client_name" varchar(120);--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "origin_city" varchar(80);--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "destination_city" varchar(120);--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "volume_m3" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "weight_tn" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "advances" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "detraction_rate" numeric(5, 2) DEFAULT '4.00' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "detraction_amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "detraction_status" "detraction_status" DEFAULT 'PENDIENTE' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "detraction_paid_at" date;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "detraction_receipt" varchar(40);--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "detraction_operation" varchar(40);--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "detraction_by" uuid;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "detraction_notes" text;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_detraction_by_users_id_fk" FOREIGN KEY ("detraction_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoices_detraction_idx" ON "supplier_invoices" USING btree ("detraction_status","detraction_paid_at");--> statement-breakpoint
CREATE INDEX "invoices_client_idx" ON "supplier_invoices" USING btree ("client_name");--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "invoices_detraction_rate_range" CHECK ("supplier_invoices"."detraction_rate" between 0 and 100);--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "invoices_detraction_amount_positive" CHECK ("supplier_invoices"."detraction_amount" is null or "supplier_invoices"."detraction_amount" >= 0);--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "invoices_detraction_paid_consistent" CHECK (("supplier_invoices"."detraction_status" = 'PAGADA') = ("supplier_invoices"."detraction_paid_at" is not null));--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_ruc_format" CHECK ("suppliers"."ruc" is null or "suppliers"."ruc" ~ '^[0-9]{11}$');--> statement-breakpoint
-- Las facturas ya registradas entran al control de detracciones con su monto calculado:
-- 4 % del total con IGV redondeado al sol más próximo, y "no aplica" por debajo del umbral
-- de S/ 400. Las facturas en dólares quedan fuera: el depósito se hace en soles y haría
-- falta un tipo de cambio. Sin esto aparecerían todas pendientes y sin importe.
UPDATE "supplier_invoices"
SET "detraction_amount" = CASE WHEN "currency" = 'PEN' AND "total" > 400 THEN round("total" * 0.04) ELSE 0 END,
    "detraction_status" = CASE WHEN "currency" = 'PEN' AND "total" > 400
                               THEN 'PENDIENTE'::"detraction_status"
                               ELSE 'NO_APLICA'::"detraction_status" END
WHERE "detraction_amount" IS NULL;
