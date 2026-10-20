-- Notas de crédito y detracción redondeada hacia arriba.
--
-- 1) La factura anulada por una nota de crédito deja de desaparecer del histórico: se
--    guarda el número de la NC, su fecha y su importe junto a la factura que anula.
-- 2) "awaiting_credit_note" marca la factura rechazada que todavía espera que el proveedor
--    mande la NC, para poder perseguirla.
-- 3) Las detracciones PENDIENTES se recalculan con el redondeo nuevo (hacia el sol
--    inmediato superior). Las ya depositadas NO se tocan: el dinero está en el Banco de la
--    Nación y reescribir la cifra dejaría al sistema sin cuadrar con la constancia.

ALTER TABLE "supplier_invoices" ADD COLUMN "credit_note_number" varchar(40);--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "credit_note_date" date;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "credit_note_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "credit_note_registered_by" uuid;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "credit_note_registered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "awaiting_credit_note" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_credit_note_registered_by_users_id_fk" FOREIGN KEY ("credit_note_registered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoices_awaiting_credit_note_idx" ON "supplier_invoices" USING btree ("awaiting_credit_note");--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "invoices_credit_note_amount_positive" CHECK ("supplier_invoices"."credit_note_amount" is null or "supplier_invoices"."credit_note_amount" > 0);--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "invoices_credit_note_not_awaiting" CHECK (not ("supplier_invoices"."awaiting_credit_note" and "supplier_invoices"."credit_note_number" is not null));--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "invoices_credit_note_annulled" CHECK ("supplier_invoices"."credit_note_number" is null or "supplier_invoices"."status" = 'ANULADA');
--> statement-breakpoint
-- Recálculo de lo que todavía no se ha depositado. El redondeo hacia arriba solo puede
-- subir el importe, nunca bajarlo, así que ninguna factura queda con menos detracción de
-- la que ya tenía anotada.
UPDATE "supplier_invoices"
SET "detraction_amount" = ceil(round("total" * "detraction_rate" / 100, 2)),
    "updated_at" = now()
WHERE "detraction_status" = 'PENDIENTE'
  AND "currency" = 'PEN'
  AND "detraction_amount" IS DISTINCT FROM ceil(round("total" * "detraction_rate" / 100, 2));
