-- Las guías de cada factura de transporte, y el viaje de terceros que se ve en Salidas.
--
-- Una factura de transporte puede venir con varias guías (la del transportista y la del
-- remitente, o una por cada tramo). Se anota cuándo llegó cada una en físico; cuando llega
-- la última, empieza a correr el plazo: la factura vence 15 días después.
--
-- Las facturas que ya existían no cambian: la regla aplica a las que tengan guías anotadas,
-- que son las que se registren desde ahora (o las viejas a las que se les agregue una).
CREATE TABLE "invoice_guides" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "invoice_id" uuid NOT NULL,
  -- TRANSPORTISTA (la GRT) o REMITENTE (la guía del cliente).
  "kind" varchar(14) DEFAULT 'TRANSPORTISTA' NOT NULL,
  -- Puede faltar: la factura avisa que hay una guía por llegar aunque no se sepa su número.
  "number" varchar(40),
  "received_at" date,
  "received_by" uuid,
  "notes" varchar(250),
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "invoice_guides_kind_valid" CHECK ("kind" in ('TRANSPORTISTA', 'REMITENTE'))
);--> statement-breakpoint
ALTER TABLE "invoice_guides" ADD CONSTRAINT "invoice_guides_invoice_fk"
  FOREIGN KEY ("invoice_id") REFERENCES "supplier_invoices"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "invoice_guides" ADD CONSTRAINT "invoice_guides_received_by_fk"
  FOREIGN KEY ("received_by") REFERENCES "users"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "invoice_guides" ADD CONSTRAINT "invoice_guides_created_by_fk"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE set null;--> statement-breakpoint
CREATE INDEX "invoice_guides_invoice_idx" ON "invoice_guides" ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_guides_number_unique" ON "invoice_guides" ("invoice_id", upper(btrim("number"))) WHERE "number" is not null;
