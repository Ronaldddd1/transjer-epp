ALTER TABLE "epp_deliveries" ADD COLUMN "voided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "epp_deliveries" ADD COLUMN "voided_by" uuid;--> statement-breakpoint
ALTER TABLE "epp_deliveries" ADD COLUMN "void_reason" varchar(250);--> statement-breakpoint
ALTER TABLE "epp_deliveries" ADD COLUMN "void_movement_id" uuid;--> statement-breakpoint
ALTER TABLE "epp_deliveries" ADD CONSTRAINT "epp_deliveries_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epp_deliveries" ADD CONSTRAINT "epp_deliveries_void_movement_id_inventory_movements_id_fk" FOREIGN KEY ("void_movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "epp_deliveries" ADD CONSTRAINT "epp_deliveries_void_movement_id_unique" UNIQUE("void_movement_id");--> statement-breakpoint
ALTER TABLE "epp_deliveries" ADD CONSTRAINT "deliveries_void_consistent" CHECK (("epp_deliveries"."voided_at" is null) = ("epp_deliveries"."void_movement_id" is null));