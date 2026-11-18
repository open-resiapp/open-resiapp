ALTER TYPE "public"."mod_accounting_bank_provider" ADD VALUE 'enable_banking';--> statement-breakpoint
ALTER TYPE "public"."mod_accounting_payment_source" ADD VALUE 'enable_banking_api';--> statement-breakpoint
ALTER TABLE "mod_accounting_bank_connections" ADD COLUMN "config" jsonb;--> statement-breakpoint
ALTER TABLE "mod_accounting_bank_connections" ADD COLUMN "valid_until" timestamp;