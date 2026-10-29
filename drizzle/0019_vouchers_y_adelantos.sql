-- Comprobante de pago obligatorio y el historial de adelantos.
--
-- 1) attachment_kind gana 'VOUCHER': el archivo que respalda un pago (la captura de la
--    transferencia, la constancia del Banco de la Nación) no es la factura ni la guía, y
--    conviene distinguirlo para que no se mezcle con los adjuntos del comprobante.
-- 2) invoice_attachments puede colgar de una cuota: los pagos de préstamos y servicios
--    no pertenecen a ninguna factura, y su voucher tenía que poder guardarse igual.
-- 3) invoice_advances: cada adelanto entregado al proveedor queda como una fila con su
--    fecha, su importe y su voucher. Antes los adelantos eran un solo número dentro de la
--    factura, sin rastro de cuándo ni contra qué se habían pagado. Ese número se queda
--    donde está, como la suma de los adelantos, para no tocar ningún cálculo existente.
-- 4) payment_proof_id / detraction_proof_id / proof_id: qué archivo respalda cada pago.
--
-- No borra ni modifica nada de lo que ya había.

ALTER TYPE "attachment_kind" ADD VALUE IF NOT EXISTS 'VOUCHER';--> statement-breakpoint
CREATE TABLE "invoice_advances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"paid_at" date NOT NULL,
	"payment_reference" varchar(120),
	"notes" varchar(500),
	"proof_id" uuid,
	"paid_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_advances_amount_positive" CHECK ("invoice_advances"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "invoice_attachments" ADD COLUMN "installment_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "payment_proof_id" uuid;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "detraction_proof_id" uuid;--> statement-breakpoint
ALTER TABLE "obligation_installments" ADD COLUMN "proof_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice_advances" ADD CONSTRAINT "invoice_advances_invoice_id_supplier_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."supplier_invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_advances" ADD CONSTRAINT "invoice_advances_proof_id_invoice_attachments_id_fk" FOREIGN KEY ("proof_id") REFERENCES "public"."invoice_attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_advances" ADD CONSTRAINT "invoice_advances_paid_by_users_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_attachments" ADD CONSTRAINT "invoice_attachments_installment_id_obligation_installments_id_fk" FOREIGN KEY ("installment_id") REFERENCES "public"."obligation_installments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_payment_proof_id_invoice_attachments_id_fk" FOREIGN KEY ("payment_proof_id") REFERENCES "public"."invoice_attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_detraction_proof_id_invoice_attachments_id_fk" FOREIGN KEY ("detraction_proof_id") REFERENCES "public"."invoice_attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligation_installments" ADD CONSTRAINT "obligation_installments_proof_id_invoice_attachments_id_fk" FOREIGN KEY ("proof_id") REFERENCES "public"."invoice_attachments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_advances_invoice_idx" ON "invoice_advances" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_attachments_installment_idx" ON "invoice_attachments" USING btree ("installment_id");--> statement-breakpoint
-- El adjunto ya no cuelga solo de una factura o de un correo: una cuota también puede ser
-- su dueña. La regla sigue siendo la misma, que no haya archivos huérfanos.
ALTER TABLE "invoice_attachments" DROP CONSTRAINT "invoice_attachments_owner";--> statement-breakpoint
ALTER TABLE "invoice_attachments" ADD CONSTRAINT "invoice_attachments_owner" CHECK ("invoice_attachments"."invoice_id" is not null or "invoice_attachments"."email_id" is not null or "invoice_attachments"."installment_id" is not null);
