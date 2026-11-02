-- El directorio de clientes de provincia.
--
-- Cuando sale un viaje a provincia hace falta saber siempre lo mismo: a quién se entrega,
-- dónde queda, a qué número se llama, quién hace la estiba allá y cuánto cobra por
-- tonelada. Hoy eso vive en la cabeza de quien coordina y en conversaciones de WhatsApp,
-- así que cada viaje a un destino que no se visita hace meses empieza por preguntar.
--
-- Esto lo deja escrito y buscable por el nombre del cliente destinatario, que es como se
-- busca: "el viaje es para Comercial Jaén", y sale todo lo demás.
--
-- El costo por tonelada admite nulos: hay destinos con los que todavía no se ha cerrado
-- precio, y obligar a inventar un número sería peor que dejarlo vacío.

CREATE TABLE "province_clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"province" varchar(80) NOT NULL,
	"client_name" varchar(160) NOT NULL,
	"location" varchar(250),
	"client_phone" varchar(40),
	"stevedore_name" varchar(120),
	"stevedore_phone" varchar(40),
	"cost_per_ton" numeric(12, 2),
	"notes" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "province_clients_cost_positive" CHECK ("province_clients"."cost_per_ton" is null or "province_clients"."cost_per_ton" >= 0)
);
--> statement-breakpoint
ALTER TABLE "province_clients" ADD CONSTRAINT "province_clients_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "province_clients_province_idx" ON "province_clients" USING btree ("province");--> statement-breakpoint
-- Se busca por el nombre del destinatario, así que el índice va sobre el nombre en
-- mayúsculas: así "comercial jaén" encuentra a "COMERCIAL JAEN".
CREATE INDEX "province_clients_name_idx" ON "province_clients" USING btree (upper("client_name"));--> statement-breakpoint
-- El mismo cliente no se registra dos veces en la misma provincia: duplicarlo es tener dos
-- teléfonos distintos para la misma persona y no saber cuál vale.
CREATE UNIQUE INDEX "province_clients_unico" ON "province_clients" USING btree (upper("province"), upper("client_name"));
