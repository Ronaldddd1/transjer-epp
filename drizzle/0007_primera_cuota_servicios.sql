-- Fecha de la primera cuota de un servicio.
--
-- Aditivo y opcional: los servicios que ya existen se quedan con la columna vacía y siguen
-- generando sus vencimientos desde el día de pago, igual que antes. Solo los que la llenen
-- arrancan su calendario en la fecha indicada.

ALTER TABLE "obligations" ADD COLUMN "first_due_date" date;