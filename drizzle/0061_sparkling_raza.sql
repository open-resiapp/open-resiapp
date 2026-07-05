CREATE TABLE "mod_accounting_supplier_lookup_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country" "country" NOT NULL,
	"ico" varchar(20) NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mod_accounting_supplier_lookup_cache_country_ico_idx" ON "mod_accounting_supplier_lookup_cache" USING btree ("country","ico");