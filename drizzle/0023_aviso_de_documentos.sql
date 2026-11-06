-- Cuándo se avisó por WhatsApp que este documento estaba por vencer.
--
-- Igual que en las cuotas: el aviso sale una vez y queda marcado. Sin esto el mismo SOAT
-- llegaría todos los días durante la semana previa y la gente dejaría de leer los avisos.
-- Al cambiar la fecha de vencimiento la marca se limpia, para que el próximo vencimiento
-- también se avise.
ALTER TABLE "documents" ADD COLUMN "reminder_sent_at" timestamp with time zone;
