-- El filtro del monto, antes de aceptar o rechazar el comprobante.
--
-- Hasta ahora, el comprobante que llegaba por correo se aceptaba o se rechazaba de una, y
-- la comparación con lo pactado por el flete quedaba en la cabeza de quien aprobaba. Eso
-- es justo lo que el control en Excel hacía mal: una factura por un importe distinto al
-- acordado entraba a la cola de pagos como cualquier otra, y se descubría al pagarla.
--
-- Ahora hay un paso previo: se anota cuánto se pactó, el sistema lo compara con el total
-- del comprobante, y hasta que ese filtro no quede conforme el comprobante no se puede
-- aceptar. Si hay diferencia, queda observado hasta que alguien la corrija o la apruebe
-- dejando dicho por qué.
--
-- Lo que ya estaba aceptado o rechazado no se toca: solo los comprobantes que esperan
-- decisión pasan por el filtro.

ALTER TABLE "invoice_emails" ADD COLUMN "agreed_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "invoice_emails" ADD COLUMN "amount_status" varchar(12) DEFAULT 'PENDIENTE' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_emails" ADD COLUMN "amount_note" varchar(250);--> statement-breakpoint
ALTER TABLE "invoice_emails" ADD COLUMN "amount_checked_by" uuid;--> statement-breakpoint
ALTER TABLE "invoice_emails" ADD COLUMN "amount_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoice_emails" ADD CONSTRAINT "invoice_emails_amount_checked_by_users_id_fk" FOREIGN KEY ("amount_checked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_emails" ADD CONSTRAINT "invoice_emails_amount_status_valid" CHECK ("invoice_emails"."amount_status" in ('PENDIENTE','CONFORME','OBSERVADO'));--> statement-breakpoint
CREATE INDEX "invoice_emails_amount_idx" ON "invoice_emails" USING btree ("amount_status");--> statement-breakpoint
-- Lo ya decidido entra como conforme: su monto se revisó en su momento, fuera del sistema,
-- y dejarlo pendiente llenaría la bandeja de filtros por hacer sobre comprobantes cerrados.
UPDATE "invoice_emails" SET "amount_status" = 'CONFORME' WHERE "status" <> 'POR_APROBAR';
