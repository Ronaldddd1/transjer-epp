-- Asistencia diaria y los datos que le faltaban a la ficha del trabajador.
--
-- 1) attendance: una fila por trabajador y día, con presente, falta o justificado. Los
--    días que no se registran no existen: así los domingos y feriados no cuentan como
--    falta ni como presencia.
-- 2) La dirección y el contacto de emergencia del trabajador.
--
-- No borra ni modifica nada de lo que ya había.

CREATE TABLE "attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"day" date NOT NULL,
	"status" varchar(12) NOT NULL,
	"reason" varchar(160),
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_status_valid" CHECK ("attendance"."status" in ('PRESENTE','FALTA','JUSTIFICADO'))
);
--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "address" varchar(200);--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "emergency_contact_name" varchar(120);--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "emergency_contact_phone" varchar(20);--> statement-breakpoint
ALTER TABLE "employees" ADD COLUMN "emergency_contact_relation" varchar(40);--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_employee_day" ON "attendance" USING btree ("employee_id","day");--> statement-breakpoint
CREATE INDEX "attendance_day_idx" ON "attendance" USING btree ("day");