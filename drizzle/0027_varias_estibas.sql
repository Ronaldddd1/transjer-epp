-- Varias estibas por cliente de provincia, para comparar precios y tener a quién llamar
-- si la de siempre no puede.
--
-- La estiba que cada cliente ya tenía pasa a ser la primera de su lista. Las columnas de
-- antes en province_clients se quedan (con la más barata), para no romper nada que las lea.
CREATE TABLE "province_client_stevedores" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "province_client_id" uuid NOT NULL,
  "name" varchar(120),
  "phone" varchar(40),
  "cost_per_ton" numeric(12, 2),
  "notes" varchar(250),
  "position" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "province_client_stevedores_cost_positive" CHECK ("cost_per_ton" is null or "cost_per_ton" >= 0),
  CONSTRAINT "province_client_stevedores_something" CHECK ("name" is not null or "phone" is not null or "cost_per_ton" is not null)
);--> statement-breakpoint
ALTER TABLE "province_client_stevedores" ADD CONSTRAINT "province_client_stevedores_client_fk"
  FOREIGN KEY ("province_client_id") REFERENCES "province_clients"("id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "province_client_stevedores_client_idx" ON "province_client_stevedores" ("province_client_id", "position");--> statement-breakpoint
INSERT INTO "province_client_stevedores" ("province_client_id", "name", "phone", "cost_per_ton", "position")
  SELECT "id", nullif(btrim("stevedore_name"), ''), nullif(btrim("stevedore_phone"), ''), "cost_per_ton", 0
  FROM "province_clients"
  WHERE nullif(btrim("stevedore_name"), '') is not null
     or nullif(btrim("stevedore_phone"), '') is not null
     or "cost_per_ton" is not null;
