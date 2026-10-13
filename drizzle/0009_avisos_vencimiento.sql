-- Marca de aviso de vencimiento.
--
-- Aditiva. Guarda cuándo se avisó por WhatsApp que una cuota estaba por vencer, para que
-- el mismo vencimiento no se avise todos los días hasta que se pague. Las cuotas que ya
-- existen quedan sin marca: la primera corrida avisará de las que venzan en los próximos
-- días, que es lo correcto.

ALTER TABLE "obligation_installments" ADD COLUMN "reminder_sent_at" timestamp with time zone;