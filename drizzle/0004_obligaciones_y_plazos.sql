CREATE TYPE "public"."installment_status" AS ENUM('PENDIENTE', 'PAGADA', 'ANULADA');--> statement-breakpoint
CREATE TYPE "public"."obligation_status" AS ENUM('ACTIVA', 'CERRADA', 'ANULADA');--> statement-breakpoint
CREATE TYPE "public"."obligation_type" AS ENUM('PRESTAMO', 'SERVICIO', 'ALQUILER', 'IMPUESTO', 'OTRO');--> statement-breakpoint
CREATE TYPE "public"."payment_term" AS ENUM('CONTADO', 'CREDITO');--> statement-breakpoint
CREATE TABLE "obligation_installments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"obligation_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"due_date" date NOT NULL,
	"principal" numeric(14, 2),
	"interest" numeric(14, 2),
	"insurance" numeric(14, 2),
	"fees" numeric(14, 2),
	"total" numeric(14, 2),
	"balance_after" numeric(14, 2),
	"status" "installment_status" DEFAULT 'PENDIENTE' NOT NULL,
	"paid_at" date,
	"paid_amount" numeric(14, 2),
	"payment_reference" varchar(120),
	"paid_by" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "installments_total_positive" CHECK ("obligation_installments"."total" is null or "obligation_installments"."total" > 0),
	CONSTRAINT "installments_paid_consistent" CHECK (("obligation_installments"."status" = 'PAGADA') = ("obligation_installments"."paid_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "obligations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "obligation_type" DEFAULT 'SERVICIO' NOT NULL,
	"name" varchar(160) NOT NULL,
	"creditor" varchar(160) NOT NULL,
	"reference" varchar(80),
	"currency" varchar(3) DEFAULT 'PEN' NOT NULL,
	"principal" numeric(14, 2),
	"annual_rate" numeric(6, 3),
	"installments_count" integer,
	"disbursed_at" date,
	"billing_day" integer,
	"variable_amount" boolean DEFAULT false NOT NULL,
	"fixed_amount" numeric(14, 2),
	"status" "obligation_status" DEFAULT 'ACTIVA' NOT NULL,
	"notes" text,
	"created_by" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "obligations_currency_valid" CHECK ("obligations"."currency" in ('PEN','USD')),
	CONSTRAINT "obligations_billing_day_range" CHECK ("obligations"."billing_day" is null or "obligations"."billing_day" between 1 and 28),
	CONSTRAINT "obligations_principal_positive" CHECK ("obligations"."principal" is null or "obligations"."principal" > 0)
);
--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "payment_term" "payment_term" DEFAULT 'CONTADO' NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "term_days" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "guide_received_at" date;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "pay_due_date" date;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "default_payment_term" "payment_term" DEFAULT 'CONTADO' NOT NULL;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN "default_term_days" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "obligation_installments" ADD CONSTRAINT "obligation_installments_obligation_id_obligations_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."obligations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligation_installments" ADD CONSTRAINT "obligation_installments_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "obligation_installment_number_unique" ON "obligation_installments" USING btree ("obligation_id","number");--> statement-breakpoint
CREATE INDEX "installments_status_due_idx" ON "obligation_installments" USING btree ("status","due_date");--> statement-breakpoint
CREATE INDEX "installments_obligation_idx" ON "obligation_installments" USING btree ("obligation_id");--> statement-breakpoint
CREATE INDEX "obligations_status_type_idx" ON "obligations" USING btree ("status","type");--> statement-breakpoint
CREATE INDEX "obligations_creditor_idx" ON "obligations" USING btree ("creditor");--> statement-breakpoint
CREATE INDEX "invoices_pay_due_idx" ON "supplier_invoices" USING btree ("status","pay_due_date");--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "invoices_term_days_range" CHECK ("supplier_invoices"."term_days" between 0 and 180);--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_term_days_range" CHECK ("suppliers"."default_term_days" between 0 and 180);--> statement-breakpoint
-- Las facturas que ya estaban registradas entran al nuevo cálculo como contado: la fecha
-- límite es un día después de que llegaron. Sin esto aparecerían sin vencimiento, como si
-- estuvieran esperando una guía que nadie pidió.
UPDATE "supplier_invoices"
SET "pay_due_date" = ((coalesce("received_at", "created_at") AT TIME ZONE 'America/Lima')::date + "term_days")
WHERE "pay_due_date" IS NULL AND "payment_term" = 'CONTADO';
