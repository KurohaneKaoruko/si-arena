ALTER TABLE "game_entries" ADD COLUMN "points" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "game_entries" ADD COLUMN "placement_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "boss" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "kind" text DEFAULT 'ranked' NOT NULL;--> statement-breakpoint
ALTER TABLE "match_participants" ADD COLUMN "boss_snapshot" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "matches_arena_active_key" ON "matches" USING btree ("game_id") WHERE kind = 'arena' AND status IN ('pending', 'running');--> statement-breakpoint
CREATE INDEX "matches_game_kind_created_idx" ON "matches" USING btree ("game_id","kind","created_at");--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_kind_values" CHECK ("matches"."kind" IN ('ranked', 'practice', 'boss', 'arena'));