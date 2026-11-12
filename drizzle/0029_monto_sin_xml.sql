-- Los comprobantes que llegan sin XML también pasan por el filtro del monto.
--
-- Sin XML el sistema no sabe cuánto cobra la factura, así que quien verifica escribe el
-- importe que dice el PDF (sin IGV) y se compara con lo pactado como con cualquier otro.
ALTER TABLE "invoice_emails" ADD COLUMN "manual_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "invoice_emails" ADD COLUMN "manual_currency" varchar(3);--> statement-breakpoint
ALTER TABLE "invoice_emails" ADD CONSTRAINT "invoice_emails_manual_currency_valid"
  CHECK ("manual_currency" is null or "manual_currency" in ('PEN', 'USD'));
