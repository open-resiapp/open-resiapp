ALTER TABLE "board_members" ADD COLUMN "entity_id" uuid;--> statement-breakpoint
ALTER TABLE "community_posts" ADD COLUMN "entity_id" uuid;--> statement-breakpoint
ALTER TABLE "core_module_grants" ADD COLUMN "entity_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "entity_id" uuid;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "entity_id" uuid;--> statement-breakpoint
ALTER TABLE "mandates" ADD COLUMN "from_entity_id" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "entity_id" uuid;--> statement-breakpoint
ALTER TABLE "votes" ADD COLUMN "entity_id" uuid;--> statement-breakpoint
ALTER TABLE "votings" ADD COLUMN "entity_id" uuid;--> statement-breakpoint
ALTER TABLE "board_members" ADD CONSTRAINT "board_members_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core_module_grants" ADD CONSTRAINT "core_module_grants_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_from_entity_id_entities_id_fk" FOREIGN KEY ("from_entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votings" ADD CONSTRAINT "votings_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE restrict ON UPDATE no action;