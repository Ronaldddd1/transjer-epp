-- Aprobación de los comprobantes que llegan por correo.
--
-- Hasta ahora, un correo con el XML legible creaba la factura solo. A partir de aquí el
-- correo queda esperando a que alguien de Finanzas o el administrador lo acepte o lo
-- rechace: lo que llega por correo es lo que manda el proveedor, no lo que la empresa
-- reconoce como deuda, y esa diferencia conviene que la decida una persona.
--
-- El estado deja de ser un enum de Postgres y pasa a ser texto con CHECK, por lo mismo
-- que en las obligaciones: Drizzle corre todas las migraciones pendientes dentro de una
-- sola transacción y Postgres no deja usar un valor recién agregado a un enum hasta que
-- esa transacción cierra. Con texto, agregar un estado más adelante es ampliar el CHECK.
--
-- Aditiva: ningún correo ya procesado cambia de estado, y ninguna factura se toca.

-- El DROP DEFAULT va antes del cambio de tipo: con el valor por defecto puesto, Postgres
-- no puede convertir la columna y la migración entera se cae.
ALTER TABLE "invoice_emails" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "invoice_emails" ALTER COLUMN "status" SET DATA TYPE varchar(16) USING "status"::text;--> statement-breakpoint
ALTER TABLE "invoice_emails" ALTER COLUMN "status" SET DEFAULT 'REVISAR';--> statement-breakpoint

-- Quién decidió y cuándo. Un rechazo le llega al proveedor con el nombre de la empresa,
-- así que tiene que quedar claro de quién salió.
ALTER TABLE "invoice_emails" ADD COLUMN "decided_by" uuid;--> statement-breakpoint
ALTER TABLE "invoice_emails" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint

-- El motivo del rechazo y lo que se le escribió al proveedor.
ALTER TABLE "invoice_emails" ADD COLUMN "reject_reason" varchar(30);--> statement-breakpoint
ALTER TABLE "invoice_emails" ADD COLUMN "reject_comment" text;--> statement-breakpoint

-- La respuesta enviada: a quién, cuándo, y por qué no salió si falló. Sin esto, un
-- rechazo cuyo correo no se envió se vería igual que uno que sí llegó, y el proveedor
-- seguiría esperando una respuesta que nadie mandó.
ALTER TABLE "invoice_emails" ADD COLUMN "reply_to" varchar(250);--> statement-breakpoint
ALTER TABLE "invoice_emails" ADD COLUMN "reply_body" text;--> statement-breakpoint
ALTER TABLE "invoice_emails" ADD COLUMN "reply_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "invoice_emails" ADD COLUMN "reply_error" text;--> statement-breakpoint

ALTER TABLE "invoice_emails" ADD CONSTRAINT "invoice_emails_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_emails" ADD CONSTRAINT "invoice_emails_status_valid" CHECK ("invoice_emails"."status" in ('POR_APROBAR','PROCESADO','REVISAR','DESCARTADO','RECHAZADO','ERROR'));--> statement-breakpoint
DROP TYPE "public"."invoice_email_status";
