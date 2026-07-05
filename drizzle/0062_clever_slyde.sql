CREATE TYPE "public"."mod_accounting_meter_type" AS ENUM('heat', 'water_cold', 'water_hot', 'electricity');--> statement-breakpoint
CREATE TABLE "mod_accounting_meter_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"unit_entity_id" uuid NOT NULL,
	"meter_type" "mod_accounting_meter_type" NOT NULL,
	"reading_date" timestamp NOT NULL,
	"value_milli" integer NOT NULL,
	"voided_at" timestamp,
	"voided_by_id" uuid,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "mod_accounting_meter_readings_value_check" CHECK ("mod_accounting_meter_readings"."value_milli" >= 0)
);
--> statement-breakpoint
ALTER TABLE "mod_accounting_meter_readings" ADD CONSTRAINT "mod_accounting_meter_readings_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_meter_readings" ADD CONSTRAINT "mod_accounting_meter_readings_unit_entity_id_entities_id_fk" FOREIGN KEY ("unit_entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_meter_readings" ADD CONSTRAINT "mod_accounting_meter_readings_voided_by_id_users_id_fk" FOREIGN KEY ("voided_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mod_accounting_meter_readings" ADD CONSTRAINT "mod_accounting_meter_readings_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mod_accounting_meter_readings_unit_idx" ON "mod_accounting_meter_readings" USING btree ("unit_entity_id","meter_type","reading_date");