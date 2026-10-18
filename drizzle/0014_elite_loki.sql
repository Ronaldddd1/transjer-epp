-- Facturas de transporte y facturas de servicio.
--
-- Quien aprueba el comprobante dice de cuál de las dos se trata, y de eso dependen el
-- plazo de pago (15 días para un flete, al contado para un servicio corriente) y los
-- datos del viaje que se piden.
--
-- Las facturas anteriores a este cambio quedan sin clasificar (service_type en null) y
-- conservan su fecha límite tal como está: la regla nueva rige de aquí en adelante.

ALTER TABLE "supplier_invoices" ADD COLUMN "dispatch_note" varchar(40);--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD COLUMN "service_type" varchar(12);--> statement-breakpoint
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "invoices_service_type_valid" CHECK ("supplier_invoices"."service_type" is null or "supplier_invoices"."service_type" in ('TRANSPORTE','SERVICIO'));--> statement-breakpoint

-- Las que ya tienen datos de viaje cargados son de transporte sin lugar a dudas: la
-- placa y el cliente solo se llenan en los fletes. Clasificarlas ahora evita que el
-- histórico salga vacío en los filtros nuevos. No se les toca la fecha de pago.
UPDATE "supplier_invoices"
SET "service_type" = 'TRANSPORTE'
WHERE "service_type" IS NULL
  AND ("plate" IS NOT NULL OR "client_name" IS NOT NULL OR "grt_number" IS NOT NULL);
