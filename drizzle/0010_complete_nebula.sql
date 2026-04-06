CREATE TYPE "public"."auth_result" AS ENUM('success', 'invalid_key', 'insufficient_permission', 'rate_limited', 'unauthenticated');--> statement-breakpoint
ALTER TYPE "public"."pairing_status" ADD VALUE 'locked';--> statement-breakpoint
CREATE TABLE "external_api_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid,
	"endpoint" varchar(255) NOT NULL,
	"method" varchar(10) NOT NULL,
	"ip_address" varchar(45),
	"user_agent" text,
	"status_code" integer NOT NULL,
	"auth_result" "auth_result" NOT NULL,
	"response_time_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "external_connections" ADD COLUMN "previous_api_key_hash" varchar(255);--> statement-breakpoint
ALTER TABLE "external_connections" ADD COLUMN "previous_key_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "pairing_requests" ADD COLUMN "failed_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pairing_requests" ADD COLUMN "locked_at" timestamp;--> statement-breakpoint
ALTER TABLE "pairing_requests" ADD COLUMN "rotation_for_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "external_api_logs" ADD CONSTRAINT "external_api_logs_connection_id_external_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."external_connections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pairing_requests" ADD CONSTRAINT "pairing_requests_rotation_for_connection_id_external_connections_id_fk" FOREIGN KEY ("rotation_for_connection_id") REFERENCES "public"."external_connections"("id") ON DELETE no action ON UPDATE no action;