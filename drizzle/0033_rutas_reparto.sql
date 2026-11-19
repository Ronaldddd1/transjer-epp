-- Rutas de reparto: la programación diaria del cliente convertida en rutas por móvil.
--
-- route_places      los lugares fijos: el centro de recojo (Lurín) y la cochera.
-- geo_cache         dónde quedó cada dirección; si alguien movió el pin, se recuerda y la
--                   próxima vez que llegue la misma dirección ya sale bien ubicada.
-- route_plans       una programación (un Excel) para un día de servicio.
-- route_plan_vehicles las móviles de ese día, con su capacidad y el resultado (km, tiempo,
--                   el trazo por las calles).
-- route_plan_stops  las paradas (una por dirección), con su ubicación y el orden en su móvil.
CREATE TABLE "route_places" (
  "key" varchar(20) PRIMARY KEY NOT NULL,
  "name" varchar(120) NOT NULL,
  "address" varchar(240),
  "lat" double precision NOT NULL,
  "lng" double precision NOT NULL,
  "updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "geo_cache" (
  "key" varchar(400) PRIMARY KEY NOT NULL,
  "query" varchar(400),
  "lat" double precision NOT NULL,
  "lng" double precision NOT NULL,
  "quality" varchar(12) NOT NULL,
  "label" varchar(400),
  "updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "route_plans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "service_date" date NOT NULL,
  "name" varchar(160) NOT NULL,
  "file_name" varchar(240),
  "service_minutes" integer DEFAULT 15 NOT NULL,
  "status" varchar(12) DEFAULT 'BORRADOR' NOT NULL,
  "total_km" numeric(10, 2),
  "approximate" boolean DEFAULT false NOT NULL,
  "calculated_at" timestamp with time zone,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "route_plans_date_idx" ON "route_plans" ("service_date");--> statement-breakpoint
CREATE TABLE "route_plan_vehicles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "plan_id" uuid NOT NULL REFERENCES "route_plans"("id") ON DELETE CASCADE,
  "vehicle_id" uuid REFERENCES "vehicles"("id") ON DELETE SET NULL,
  "plate" varchar(20) NOT NULL,
  "position" integer NOT NULL,
  "capacity_kg" numeric(10, 2),
  "capacity_m3" numeric(10, 3),
  "max_stops" integer,
  "km" numeric(10, 2),
  "minutes" integer,
  "load_kg" numeric(10, 2),
  "load_m3" numeric(10, 4),
  "geometry" jsonb
);--> statement-breakpoint
CREATE INDEX "route_plan_vehicles_plan_idx" ON "route_plan_vehicles" ("plan_id");--> statement-breakpoint
CREATE TABLE "route_plan_stops" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "plan_id" uuid NOT NULL REFERENCES "route_plans"("id") ON DELETE CASCADE,
  "address_key" varchar(400) NOT NULL,
  "orders" text[] NOT NULL,
  "customer" varchar(400) NOT NULL,
  "phone" varchar(120),
  "address" varchar(400) NOT NULL,
  "clean_address" varchar(400) NOT NULL,
  "reference" varchar(400),
  "district" varchar(80) NOT NULL,
  "dispatch_type" varchar(80),
  "agency" varchar(160),
  "notes" text,
  "zone" varchar(40),
  "deadline" date,
  "kg" numeric(10, 2) DEFAULT 0 NOT NULL,
  "m3" numeric(10, 4) DEFAULT 0 NOT NULL,
  "products" jsonb,
  "lat" double precision,
  "lng" double precision,
  "geo_quality" varchar(12),
  "geo_label" varchar(400),
  "plan_vehicle_id" uuid REFERENCES "route_plan_vehicles"("id") ON DELETE SET NULL,
  "sequence" integer
);--> statement-breakpoint
CREATE INDEX "route_plan_stops_plan_idx" ON "route_plan_stops" ("plan_id");
