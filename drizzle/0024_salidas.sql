-- Las salidas diarias de la flota y el control de su liquidación.
--
-- Cada día se anota qué unidad salió, con qué conductor, para qué cliente y a dónde, con
-- el número del documento que respalda el viaje: el FO en Alicorp, la guía o la orden de
-- servicio en los demás. Después ese documento se liquida con el cliente, y hasta que no
-- se liquida es plata por cobrar: por eso cada salida queda PENDIENTE o LIQUIDADA, con la
-- fecha en que se liquidó.
--
-- El número de documento no se repite para un mismo cliente y tipo (sin distinguir
-- mayúsculas ni espacios): un FO anotado dos veces se cobraría o se liquidaría dos veces.

CREATE TABLE "vehicle_trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" date NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"driver_id" uuid,
	"client" varchar(120) NOT NULL,
	"destination" varchar(160),
	"doc_type" varchar(12) NOT NULL,
	"doc_number" varchar(40) NOT NULL,
	"status" varchar(12) DEFAULT 'PENDIENTE' NOT NULL,
	"settled_at" date,
	"settled_by" uuid,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_trips_status_valid" CHECK ("vehicle_trips"."status" in ('PENDIENTE','LIQUIDADO')),
	CONSTRAINT "vehicle_trips_doc_type_valid" CHECK ("vehicle_trips"."doc_type" in ('FO','GUIA','OS','OTRO')),
	CONSTRAINT "vehicle_trips_settled_consistent" CHECK (("vehicle_trips"."status" = 'LIQUIDADO') = ("vehicle_trips"."settled_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "vehicle_trips" ADD CONSTRAINT "vehicle_trips_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vehicle_trips" ADD CONSTRAINT "vehicle_trips_driver_id_employees_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vehicle_trips" ADD CONSTRAINT "vehicle_trips_settled_by_users_id_fk" FOREIGN KEY ("settled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "vehicle_trips" ADD CONSTRAINT "vehicle_trips_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "vehicle_trips_day_idx" ON "vehicle_trips" USING btree ("day");
--> statement-breakpoint
CREATE INDEX "vehicle_trips_status_idx" ON "vehicle_trips" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_trips_doc_unique" ON "vehicle_trips" USING btree (lower(btrim("client")), "doc_type", upper(btrim("doc_number")));
