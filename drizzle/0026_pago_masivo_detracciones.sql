-- Pago masivo de detracciones (Depósitos Masivos de SUNAT).
--
-- Cada proveedor guarda su cuenta de detracciones del Banco de la Nación, que es a donde va
-- el depósito. Las detracciones que se pagan juntas forman un lote: el sistema arma con él
-- el archivo TXT que se sube en SUNAT Operaciones en Línea, y cuando el pago está hecho,
-- la constancia se registra una sola vez para todo el lote.
--
-- Solo agrega: no toca ni borra datos.
ALTER TABLE "suppliers" ADD COLUMN "detraction_account" varchar(11);--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_detraction_account_format"
  CHECK ("detraction_account" is null or "detraction_account" ~ '^[0-9]{11}$');--> statement-breakpoint

CREATE TABLE "detraction_batches" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  -- Número de lote AANNNN: año en dos dígitos y un correlativo. SUNAT no deja repetirlo.
  "lot" varchar(6) NOT NULL,
  "payer_ruc" varchar(11) NOT NULL,
  "payer_name" varchar(35) NOT NULL,
  "total" numeric(14, 2) NOT NULL,
  "invoice_count" integer NOT NULL,
  -- GENERADO: el archivo está listo y falta pagar. PAGADO: ya se registró la constancia.
  -- ANULADO: no se llegó a pagar y sus detracciones volvieron a pendientes.
  "status" varchar(10) DEFAULT 'GENERADO' NOT NULL,
  "paid_at" date,
  "operation" varchar(40),
  "proof_id" uuid,
  "notes" text,
  "created_by" uuid,
  "paid_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "detraction_batches_lot_format" CHECK ("lot" ~ '^[0-9]{6}$'),
  CONSTRAINT "detraction_batches_status" CHECK ("status" in ('GENERADO', 'PAGADO', 'ANULADO')),
  CONSTRAINT "detraction_batches_paid" CHECK (("status" = 'PAGADO') = ("paid_at" is not null))
);--> statement-breakpoint
ALTER TABLE "detraction_batches" ADD CONSTRAINT "detraction_batches_proof_fk"
  FOREIGN KEY ("proof_id") REFERENCES "invoice_attachments"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "detraction_batches" ADD CONSTRAINT "detraction_batches_created_by_fk"
  FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "detraction_batches" ADD CONSTRAINT "detraction_batches_paid_by_fk"
  FOREIGN KEY ("paid_by") REFERENCES "users"("id") ON DELETE set null;--> statement-breakpoint
CREATE UNIQUE INDEX "detraction_batches_payer_lot_idx" ON "detraction_batches" ("payer_ruc", "lot");--> statement-breakpoint
CREATE INDEX "detraction_batches_status_idx" ON "detraction_batches" ("status", "created_at");--> statement-breakpoint

ALTER TABLE "supplier_invoices" ADD COLUMN "detraction_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_detraction_batch_fk"
  FOREIGN KEY ("detraction_batch_id") REFERENCES "detraction_batches"("id") ON DELETE set null;--> statement-breakpoint
CREATE INDEX "supplier_invoices_detraction_batch_idx" ON "supplier_invoices" ("detraction_batch_id");
