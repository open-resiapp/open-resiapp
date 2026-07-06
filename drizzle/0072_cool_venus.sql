CREATE TYPE "public"."mod_accounting_rate_series" AS ENUM('ecb_mro', 'cnb_repo');--> statement-breakpoint
CREATE TABLE "mod_accounting_interest_rate_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"series" "mod_accounting_rate_series" NOT NULL,
	"valid_from" date NOT NULL,
	"rate_milli_pct" integer NOT NULL,
	"source" varchar(200),
	"fetched_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "mod_accounting_interest_rate_series_from_unique" ON "mod_accounting_interest_rate_history" USING btree ("series","valid_from");