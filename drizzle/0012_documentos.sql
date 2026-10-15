-- Documentos de trabajadores y vehículos.
--
-- Dos tablas nuevas y nada más: no toca ninguna de las que ya existen, así que no hay
-- forma de que afecte a lo que ya está cargado.
--
--   vehicles   la flota, por placa. Hasta ahora la placa solo vivía escrita dentro del
--              nombre de un seguro o una cochera, que sirve para leerlo pero no para
--              buscar por unidad ni para colgarle los papeles.
--
--   documents  el archivo de cada trabajador y de cada vehículo, con su fecha de
--              vencimiento. Esa fecha es el motivo de que esto no sea una carpeta
--              compartida: el SOAT y la revisión técnica caducan cada año.
--
-- El archivo en sí se guarda igual que los adjuntos de las facturas, con el mismo
-- almacén, así que no hay dos maneras distintas de guardar un PDF en el sistema.

CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid,
	"vehicle_id" uuid,
	"kind" varchar(30) DEFAULT 'OTRO' NOT NULL,
	"title" varchar(160),
	"issued_at" date,
	"expires_at" date,
	"notes" text,
	"filename" varchar(250) NOT NULL,
	"content_type" varchar(120) NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_driver" varchar(20) NOT NULL,
	"storage_key" varchar(500),
	"content" "bytea",
	"uploaded_by" uuid,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_owner" CHECK (("documents"."employee_id" is not null) <> ("documents"."vehicle_id" is not null)),
	CONSTRAINT "documents_size_positive" CHECK ("documents"."size_bytes" > 0),
	CONSTRAINT "documents_fechas_coherentes" CHECK ("documents"."expires_at" is null or "documents"."issued_at" is null or "documents"."expires_at" >= "documents"."issued_at")
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plate" varchar(10) NOT NULL,
	"description" varchar(160),
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_plate_unique" UNIQUE("plate")
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_employee_idx" ON "documents" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "documents_vehicle_idx" ON "documents" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "documents_expires_idx" ON "documents" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "vehicles_active_idx" ON "vehicles" USING btree ("active");
