-- Mantenimiento de la flota y tres roles nuevos.
--
-- 1) Roles: mantenimiento, documentación y operación.
-- 2) El kilometraje de cada unidad, con la fecha en que se leyó: sin esa fecha, un
--    odómetro no sirve para calcular cuánto falta para el próximo cambio de aceite.
-- 3) maintenance_plans: cada cuánto le toca a una unidad un mantenimiento, solo cuando
--    se quiere cambiar la periodicidad por defecto.
-- 4) maintenance_records: lo que de verdad se hizo. De su última fila sale lo próximo.
--
-- No borra ni modifica nada de lo que ya había.

ALTER TYPE "public"."role" ADD VALUE 'MANTENIMIENTO';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE 'DOCUMENTACION';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE 'OPERACION';--> statement-breakpoint
CREATE TABLE "maintenance_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"kind" varchar(24) NOT NULL,
	"every_km" integer,
	"every_days" integer,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_plans_tiene_regla" CHECK ("maintenance_plans"."every_km" is not null or "maintenance_plans"."every_days" is not null),
	CONSTRAINT "maintenance_plans_km_positivo" CHECK ("maintenance_plans"."every_km" is null or "maintenance_plans"."every_km" > 0),
	CONSTRAINT "maintenance_plans_dias_positivo" CHECK ("maintenance_plans"."every_days" is null or "maintenance_plans"."every_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "maintenance_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"kind" varchar(24) NOT NULL,
	"serviced_at" date NOT NULL,
	"odometer_km" integer,
	"cost" numeric(12, 2),
	"currency" varchar(3) DEFAULT 'PEN' NOT NULL,
	"workshop" varchar(120),
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_records_km_positivo" CHECK ("maintenance_records"."odometer_km" is null or "maintenance_records"."odometer_km" >= 0),
	CONSTRAINT "maintenance_records_costo_positivo" CHECK ("maintenance_records"."cost" is null or "maintenance_records"."cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "odometer_km" integer;--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN "odometer_at" date;--> statement-breakpoint
ALTER TABLE "maintenance_plans" ADD CONSTRAINT "maintenance_plans_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "maintenance_plans_vehicle_kind" ON "maintenance_plans" USING btree ("vehicle_id","kind");--> statement-breakpoint
CREATE INDEX "maintenance_records_vehicle_idx" ON "maintenance_records" USING btree ("vehicle_id","kind","serviced_at");--> statement-breakpoint
CREATE INDEX "maintenance_records_date_idx" ON "maintenance_records" USING btree ("serviced_at");