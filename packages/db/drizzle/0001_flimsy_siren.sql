CREATE TABLE "matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" text NOT NULL,
	"release" text NOT NULL,
	"config" jsonb NOT NULL,
	"resolved_limits" jsonb NOT NULL,
	"bot_protocol_version" integer NOT NULL,
	"seed" bigint NOT NULL,
	"initiator_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"execution_id" uuid,
	"result" jsonb,
	"replay_file" jsonb,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "matches_seed_range" CHECK ("matches"."seed" >= 0 AND "matches"."seed" <= 4294967295),
	CONSTRAINT "matches_status_values" CHECK ("matches"."status" IN ('pending', 'running', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "match_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"slot" integer NOT NULL,
	"name_snapshot" text NOT NULL,
	"official_snapshot" boolean NOT NULL,
	"rank" integer,
	"rating_before" numeric(12, 6),
	"rating_after" numeric(12, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_initiator_id_users_id_fk" FOREIGN KEY ("initiator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "matches_initiator_idempotency_key" ON "matches" USING btree ("initiator_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "matches_initiator_active_key" ON "matches" USING btree ("initiator_id","game_id") WHERE status IN ('pending', 'running');--> statement-breakpoint
CREATE INDEX "matches_status_created_idx" ON "matches" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "matches_lease_idx" ON "matches" USING btree ("lease_expires_at") WHERE lease_expires_at IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "matches_execution_id_key" ON "matches" USING btree ("execution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "match_participants_match_user_key" ON "match_participants" USING btree ("match_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "match_participants_match_slot_key" ON "match_participants" USING btree ("match_id","slot");--> statement-breakpoint
CREATE INDEX "match_participants_user_match_idx" ON "match_participants" USING btree ("user_id","match_id");