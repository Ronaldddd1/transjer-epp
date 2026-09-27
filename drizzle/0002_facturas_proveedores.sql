CREATE TYPE "public"."attachment_kind" AS ENUM('FACTURA_PDF', 'FACTURA_XML', 'GRT', 'OTRO');--> statement-breakpoint
CREATE TYPE "public"."invoice_doc_type" AS ENUM('FACTURA', 'BOLETA', 'NOTA_CREDITO', 'NOTA_DEBITO');--> statement-breakpoint
CREATE TYPE "public"."invoice_email_status" AS ENUM('PROCESADO', 'REVISAR', 'DESCARTADO', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."invoice_source" AS ENUM('MANUAL', 'CORREO');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('PENDIENTE', 'PAGADA', 'OBSERVADA', 'ANULADA');--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE 'FINANZAS';--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" varchar(60) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid,
	"email_id" uuid,
	"kind" "attachment_kind" DEFAULT 'OTRO' NOT NULL,
	"filename" varchar(250) NOT NULL,
	"content_type" varchar(120) NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_driver" varchar(20) NOT NULL,
	"storage_key" varchar(500),
	"content" "bytea",
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_attachments_owner" CHECK ("invoice_attachments"."invoice_id" is not null or "invoice_attachments"."email_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "invoice_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" varchar(400) NOT NULL,
	"internet_message_id" varchar(400),
	"subject" varchar(400),
	"from_address" varchar(250),
	"from_name" varchar(250),
	"received_at" timestamp with time zone NOT NULL,
	"status" "invoice_email_status" DEFAULT 'REVISAR' NOT NULL,
	"invoice_id" uuid,
	"attachment_count" integer DEFAULT 0 NOT NULL,
	"detail" text,
	"parsed" jsonb,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_emails_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE "supplier_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"doc_type" "invoice_doc_type" DEFAULT 'FACTURA' NOT NULL,
	"series" varchar(8) NOT NULL,
	"number" varchar(12) NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date,
	"service_date" date,
	"currency" varchar(3) DEFAULT 'PEN' NOT NULL,
	"subtotal" numeric(14, 2),
	"igv" numeric(14, 2),
	"total" numeric(14, 2) NOT NULL,
	"description" varchar(250),
	"grt_number" varchar(40),
	"status" "invoice_status" DEFAULT 'PENDIENTE' NOT NULL,
	"paid_at" date,
	"payment_reference" varchar(120),
	"payment_notes" text,
	"paid_by" uuid,
	"status_reason" varchar(250),
	"source" "invoice_source" DEFAULT 'MANUAL' NOT NULL,
	"received_at" timestamp with time zone,
	"notes" text,
	"created_by" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_total_positive" CHECK ("supplier_invoices"."total" > 0),
	CONSTRAINT "invoices_currency_valid" CHECK ("supplier_invoices"."currency" in ('PEN','USD')),
	CONSTRAINT "invoices_paid_consistent" CHECK (("supplier_invoices"."status" = 'PAGADA') = ("supplier_invoices"."paid_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ruc" varchar(11) NOT NULL,
	"business_name" varchar(200) NOT NULL,
	"trade_name" varchar(200),
	"email" varchar(160),
	"phone" varchar(20),
	"contact_name" varchar(120),
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_ruc_unique" UNIQUE("ruc"),
	CONSTRAINT "suppliers_ruc_format" CHECK ("suppliers"."ruc" ~ '^[0-9]{11}$')
);
--> statement-breakpoint
ALTER TABLE "invoice_attachments" ADD CONSTRAINT "invoice_attachments_invoice_id_supplier_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."supplier_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_attachments" ADD CONSTRAINT "invoice_attachments_email_id_invoice_emails_id_fk" FOREIGN KEY ("email_id") REFERENCES "public"."invoice_emails"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_attachments" ADD CONSTRAINT "invoice_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_emails" ADD CONSTRAINT "invoice_emails_invoice_id_supplier_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."supplier_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_attachments_invoice_idx" ON "invoice_attachments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_attachments_email_idx" ON "invoice_attachments" USING btree ("email_id");--> statement-breakpoint
CREATE INDEX "invoice_emails_status_date_idx" ON "invoice_emails" USING btree ("status","received_at");--> statement-breakpoint
CREATE INDEX "invoice_emails_date_idx" ON "invoice_emails" USING btree ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_supplier_doc_unique" ON "supplier_invoices" USING btree ("supplier_id","doc_type","series","number");--> statement-breakpoint
CREATE INDEX "invoices_status_date_idx" ON "supplier_invoices" USING btree ("status","issue_date");--> statement-breakpoint
CREATE INDEX "invoices_supplier_idx" ON "supplier_invoices" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "invoices_issue_date_idx" ON "supplier_invoices" USING btree ("issue_date");--> statement-breakpoint
CREATE INDEX "suppliers_active_name_idx" ON "suppliers" USING btree ("active","business_name");