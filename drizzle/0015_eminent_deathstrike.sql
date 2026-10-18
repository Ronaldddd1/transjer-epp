-- Documentos por vehículo: la ficha de la unidad y su conductor.
--
-- Dos cosas:
--
--   1. La unidad guarda lo que mantenimiento ya llevaba en su cuadro —marca, modelo,
--      año, capacidad, constancia del MTC, GPS— y a qué conductor está asignada. El
--      conductor se guarda en la unidad porque una unidad tiene uno a la vez, y si el
--      trabajador cesa, la unidad queda sin conductor en lugar de desaparecer.
--
--   2. Un documento puede existir SIN archivo. Se sabe que el SOAT vence el 6 de mayo
--      aunque el escaneo todavía no esté cargado, y esa fecha es la que hace falta para
--      avisar. Sin esto, completar los vencimientos obligaría a tener antes todos los
--      PDF, que es justo lo que frena la carga.
--
-- Aditiva: no borra ni cambia ningún documento ni ninguna unidad.

ALTER TABLE "documents" DROP CONSTRAINT "documents_size_positive";--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "filename" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "content_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "size_bytes" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "storage_driver" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "brand" varchar(60);--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "model" varchar(60);--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "year" integer;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "capacity_tn" numeric(6, 2);--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "capacity_m3" numeric(7, 2);--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "mtc_code" varchar(40);--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "has_gps" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "driver_id" uuid;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_driver_id_employees_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vehicles_driver_idx" ON "vehicles" USING btree ("driver_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_archivo_completo" CHECK (("documents"."filename" is null) = ("documents"."storage_driver" is null)
    and ("documents"."filename" is null) = ("documents"."size_bytes" is null));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_size_positive" CHECK ("documents"."size_bytes" is null or "documents"."size_bytes" > 0);--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_year_valid" CHECK ("vehicles"."year" is null or ("vehicles"."year" >= 1970 and "vehicles"."year" <= 2100));