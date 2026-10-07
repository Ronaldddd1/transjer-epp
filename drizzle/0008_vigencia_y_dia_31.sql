-- Vigencia de los servicios y día de pago hasta 31.
--
-- El día de pago estaba topado en 28 para evitar el problema de los meses cortos, pero hay
-- servicios que vencen el 30 o el 31. El tope sube a 31 y el ajuste lo hace el generador de
-- fechas: en los meses que no llegan a ese día, el vencimiento cae en el último.
--
-- Todo es aditivo. Ningún servicio existente cambia: la vigencia queda vacía (sin plazo) y
-- los días de pago ya guardados siguen siendo válidos dentro del rango nuevo.

ALTER TABLE "obligations" DROP CONSTRAINT "obligations_billing_day_range";--> statement-breakpoint
ALTER TABLE "obligations" ADD COLUMN "ends_at" date;--> statement-breakpoint
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_vigencia_coherente" CHECK ("obligations"."ends_at" is null or "obligations"."first_due_date" is null or "obligations"."ends_at" >= "obligations"."first_due_date");--> statement-breakpoint
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_billing_day_range" CHECK ("obligations"."billing_day" is null or "obligations"."billing_day" between 1 and 31);