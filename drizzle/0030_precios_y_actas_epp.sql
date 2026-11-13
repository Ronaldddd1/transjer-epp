-- El precio de cada EPP y las actas que firma el trabajador.
--
-- El precio va en el producto, y se copia en cada entrega y devolución: el acta que firmó
-- el trabajador dice el precio de ese día, aunque después el EPP suba o baje.
--
-- batch_id junta lo que se registró de una sola vez (una entrega de varios EPP, una
-- devolución de varios), que es lo que va en una misma acta.
ALTER TABLE "products" ADD COLUMN "unit_price" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_unit_price_non_negative"
  CHECK ("unit_price" is null or "unit_price" >= 0);--> statement-breakpoint
ALTER TABLE "epp_deliveries" ADD COLUMN "unit_price" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "epp_deliveries" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
CREATE INDEX "deliveries_batch_idx" ON "epp_deliveries" ("batch_id");--> statement-breakpoint
ALTER TABLE "epp_returns" ADD COLUMN "unit_price" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "epp_returns" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
CREATE INDEX "returns_batch_idx" ON "epp_returns" ("batch_id");
