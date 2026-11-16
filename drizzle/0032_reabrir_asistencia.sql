-- Reabrir un día de asistencia ya cerrado para corregirlo.
--
-- Una marca se cierra 24 horas después de guardada. Si hubo un error y ya se cerró, quien
-- tiene permiso puede reabrir el día dejando el motivo: desde ese momento hay otras 24
-- horas para corregir. Se guarda quién lo reabrió, cuándo y por qué.
ALTER TABLE "attendance" ADD COLUMN "reopened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "reopened_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "attendance" ADD COLUMN "reopen_reason" varchar(200);
